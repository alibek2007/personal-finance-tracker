import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApiClient, type ApiClient, type Session } from '../../../test/api-client';
import { createTestApp, resetDb } from '../../../test/helpers';

type Ctx = Awaited<ReturnType<typeof createTestApp>>;

// Wednesday 15 October 2026, midday UTC. Everything below is computed against this instant.
let clock = new Date('2026-10-15T12:00:00Z');

describe('analytics API', () => {
  let ctx: Ctx;
  let api: ApiClient;
  let alex: Session;
  let checking: string;
  let cat: Record<string, string>;

  beforeAll(async () => {
    ctx = await createTestApp({}, { now: () => clock });
    api = createApiClient(ctx);
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    clock = new Date('2026-10-15T12:00:00Z');
    await resetDb(ctx.db);
    alex = await api.signUp('alex@example.com', 'Alex');
    const acc = await api.post('/api/accounts', alex, {
      name: 'Checking',
      type: 'bank',
      currency: 'USD',
      initialBalance: 100000,
    });
    checking = acc.json().id;
    const cats = (await api.get('/api/categories', alex)).json().categories as {
      id: string;
      name: string;
    }[];
    cat = Object.fromEntries(cats.map((c) => [c.name, c.id]));
  });

  const add = async (body: Record<string, unknown>) => {
    const res = await api.post('/api/transactions', alex, {
      type: 'expense',
      accountId: checking,
      description: 'x',
      ...body,
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json();
  };

  /** September (last month) and October-to-date, chosen so every figure is easy to verify by hand. */
  async function populate() {
    // September
    await add({ type: 'income', amount: 480000, categoryId: cat.Salary, date: '2026-09-01' });
    await add({ amount: 185000, categoryId: cat.Rent, date: '2026-09-01' });
    await add({ amount: 30000, categoryId: cat.Groceries, date: '2026-09-05' });
    await add({ amount: 12000, categoryId: cat.Restaurants, date: '2026-09-10' });
    await add({ amount: 5000, categoryId: cat.Coffee, date: '2026-09-12' });
    await add({ amount: 20000, categoryId: cat.Shopping, date: '2026-09-20' }); // after the 15th: "the rest of last month"
    // October (through the 15th)
    await add({ type: 'income', amount: 480000, categoryId: cat.Salary, date: '2026-10-01' });
    await add({ amount: 185000, categoryId: cat.Rent, date: '2026-10-01' });
    await add({ amount: 60000, categoryId: cat.Groceries, date: '2026-10-05' });
    await add({ amount: 8000, categoryId: cat.Restaurants, date: '2026-10-10' });
  }

  describe('GET /analytics/overview', () => {
    it('computes the month so far against the same days of last month', async () => {
      await populate();
      const o = (await api.get('/api/analytics/overview', alex)).json();
      expect(o.today).toBe('2026-10-15');
      expect(o.month).toMatchObject({
        from: '2026-10-01',
        to: '2026-10-15',
        income: 480000,
        spent: 253000,
        saved: 227000,
        daysElapsed: 15,
        daysInMonth: 31,
      });
      expect(o.month.savingsRateBp).toBe(4729);
      expect(o.previous).toMatchObject({
        from: '2026-09-01',
        to: '2026-09-15',
        income: 480000,
        spent: 232000,
        saved: 248000,
      });
      expect(o.changes).toEqual({ incomeBp: 0, spentBp: 905, savedBp: -847 });
    });

    it('total balance is net worth: opening balance + every transaction', async () => {
      await populate();
      const o = (await api.get('/api/analytics/overview', alex)).json();
      // 1,000 opening + Sept (4,800 - 1,850 - 300 - 120 - 50 - 200) + Oct (4,800 - 1,850 - 600 - 80)
      expect(o.totalBalance).toBe(
        100000 +
          (480000 - 185000 - 30000 - 12000 - 5000 - 20000) +
          (480000 - 185000 - 60000 - 8000),
      );
    });

    it('credit card debt reduces the total balance', async () => {
      const card = (
        await api.post('/api/accounts', alex, {
          name: 'Visa',
          type: 'credit_card',
          currency: 'USD',
          initialBalance: -82000,
        })
      ).json();
      expect(card.currentBalance).toBe(-82000);
      const o = (await api.get('/api/analytics/overview', alex)).json();
      expect(o.totalBalance).toBe(100000 - 82000);
    });

    it('generates real insights from the numbers, and no others', async () => {
      await populate();
      const { insights } = (await api.get('/api/analytics/overview', alex)).json();
      const text = insights.map((i: { text: string }) => i.text);
      // saved so far 2,270 + nothing more income - 200 spent in the rest of last month
      expect(text).toContain(
        "If the rest of the month looks like last month, you'll save about $2,070.",
      );
      // Food (groceries+restaurants+coffee): Oct 680 vs Sept same period 470
      expect(text).toContain(
        'You spent 45% more on Food so far this month than at this point last month.',
      );
      // total pace changed 9%, below the 15% line: no pace insight
      expect(insights.map((i: { id: string }) => i.id)).not.toContain('spending-pace');
      const food = insights.find((i: { id: string }) => i.id === 'category-trend-' + cat.Food);
      expect(food).toMatchObject({ tone: 'negative', categoryId: cat.Food });
    });

    it('is honest for a brand-new user: zeros, no insights', async () => {
      const o = (await api.get('/api/analytics/overview', alex)).json();
      expect(o.hasTransactions).toBe(false);
      expect(o.month).toMatchObject({ income: 0, spent: 0, saved: 0, savingsRateBp: null });
      expect(o.insights).toEqual([]);
      expect(o.changes).toEqual({ incomeBp: null, spentBp: null, savedBp: null });
    });

    it('transfers are not income or spending', async () => {
      const sav = (
        await api.post('/api/accounts', alex, { name: 'Savings', type: 'savings', currency: 'USD' })
      ).json();
      await add({
        type: 'transfer',
        accountId: checking,
        transferAccountId: sav.id,
        amount: 50000,
        date: '2026-10-02',
      });
      const o = (await api.get('/api/analytics/overview', alex)).json();
      expect(o.month).toMatchObject({ income: 0, spent: 0 });
      expect(o.totalBalance).toBe(100000); // moving money does not change net worth
    });

    it('refunds reduce spending and are not income', async () => {
      await add({ amount: 4999, categoryId: cat.Shopping, date: '2026-10-03' });
      await add({
        type: 'income',
        isRefund: true,
        amount: 4999,
        categoryId: cat.Shopping,
        date: '2026-10-04',
      });
      const o = (await api.get('/api/analytics/overview', alex)).json();
      expect(o.month).toMatchObject({ income: 0, spent: 0 });
    });

    it('other currencies are never mixed into the totals', async () => {
      await populate();
      const kzt = (
        await api.post('/api/accounts', alex, {
          name: 'Tenge',
          type: 'bank',
          currency: 'KZT',
          initialBalance: 90000000,
        })
      ).json();
      await api.post('/api/transactions', alex, {
        type: 'expense',
        accountId: kzt.id,
        amount: 5_000_000,
        description: 'Big KZT spend',
        date: '2026-10-03',
      });
      const o = (await api.get('/api/analytics/overview', alex)).json();
      expect(o.month.spent).toBe(253000); // unchanged
      expect(o.otherCurrencies).toEqual(['KZT']);
      expect(o.currency).toBe('USD');
    });

    it('"today" follows the user’s timezone, not the server’s', async () => {
      clock = new Date('2026-10-14T20:30:00Z'); // still the 14th in UTC, already the 15th in Almaty (UTC+5)
      expect((await api.get('/api/analytics/overview', alex)).json().today).toBe('2026-10-14');
      await api.patch('/api/me', alex, { timezone: 'Asia/Almaty' });
      const o = (await api.get('/api/analytics/overview', alex)).json();
      expect(o.today).toBe('2026-10-15');
      expect(o.month.daysElapsed).toBe(15);
    });

    it('a transaction dated "today" in the user’s timezone counts today', async () => {
      await api.patch('/api/me', alex, { timezone: 'Asia/Almaty' });
      clock = new Date('2026-10-14T20:30:00Z');
      await add({ amount: 1234, categoryId: cat.Coffee, date: '2026-10-15' });
      expect((await api.get('/api/analytics/overview', alex)).json().month.spent).toBe(1234);
    });

    it('month boundaries: on the 1st, "this month" is one day and last month is complete', async () => {
      clock = new Date('2026-11-01T09:00:00Z');
      await add({ amount: 777, date: '2026-10-31' });
      await add({ amount: 111, date: '2026-11-01' });
      const o = (await api.get('/api/analytics/overview', alex)).json();
      expect(o.month).toMatchObject({
        from: '2026-11-01',
        to: '2026-11-01',
        spent: 111,
        daysElapsed: 1,
      });
      expect(o.previous).toMatchObject({ from: '2026-10-01', to: '2026-10-01', spent: 0 });
      expect(o.insights).toEqual([]); // too early in the month to say anything
    });

    it('requires a session', async () => {
      expect((await api.get('/api/analytics/overview', null)).statusCode).toBe(401);
    });
  });

  describe('GET /analytics/cash-flow', () => {
    it('returns a zero-filled daily series for 7D ending today', async () => {
      await populate();
      const r = (await api.get('/api/analytics/cash-flow?range=7d', alex)).json();
      expect(r).toMatchObject({ from: '2026-10-09', to: '2026-10-15', unit: 'day' });
      expect(r.points).toHaveLength(7);
      expect(r.points.find((p: { start: string }) => p.start === '2026-10-10')).toMatchObject({
        expenses: 8000,
        income: 0,
        net: -8000,
      });
      expect(r.points.filter((p: { expenses: number }) => p.expenses === 0)).toHaveLength(6);
      expect(r.totals).toMatchObject({ income: 0, spent: 8000 });
    });

    it('buckets by week for 3M and by month for 1Y, covering the range exactly', async () => {
      await populate();
      const three = (await api.get('/api/analytics/cash-flow?range=3m', alex)).json();
      expect(three.unit).toBe('week');
      expect(three.points[0].start).toBe(three.from);
      expect(three.points.at(-1).end).toBe(three.to);
      const year = (await api.get('/api/analytics/cash-flow?range=1y', alex)).json();
      expect(year.unit).toBe('month');
      expect(year.points).toHaveLength(13);
      const octPoint = year.points.at(-1);
      expect(octPoint).toMatchObject({
        start: '2026-10-01',
        income: 480000,
        expenses: 253000,
        net: 227000,
      });
    });

    it('chart totals always equal the headline numbers for the same dates', async () => {
      await populate();
      const flow = (
        await api.get('/api/analytics/cash-flow?range=custom&from=2026-10-01&to=2026-10-15', alex)
      ).json();
      const o = (await api.get('/api/analytics/overview', alex)).json();
      expect(flow.totals).toMatchObject({
        income: o.month.income,
        spent: o.month.spent,
        saved: o.month.saved,
      });
      expect(flow.points.reduce((s: number, p: { income: number }) => s + p.income, 0)).toBe(
        o.month.income,
      );
      expect(flow.points.reduce((s: number, p: { expenses: number }) => s + p.expenses, 0)).toBe(
        o.month.spent,
      );
    });

    it('filters by account, category (with subcategories) and type', async () => {
      await populate();
      const other = (
        await api.post('/api/accounts', alex, { name: 'Cash', type: 'cash', currency: 'USD' })
      ).json();
      await api.post('/api/transactions', alex, {
        type: 'expense',
        accountId: other.id,
        amount: 900,
        description: 'Taxi',
        date: '2026-10-12',
        categoryId: cat.Taxi,
      });
      const range = 'range=custom&from=2026-10-01&to=2026-10-15';
      expect(
        (await api.get(`/api/analytics/cash-flow?${range}&accountId=${other.id}`, alex)).json()
          .totals.spent,
      ).toBe(900);
      expect(
        (await api.get(`/api/analytics/cash-flow?${range}&categoryId=${cat.Food}`, alex)).json()
          .totals.spent,
      ).toBe(68000);
      const income = (await api.get(`/api/analytics/cash-flow?${range}&type=income`, alex)).json();
      expect(income.totals).toMatchObject({ income: 480000, spent: 0 });
    });

    it('validates custom ranges in plain language', async () => {
      const bad = await api.get('/api/analytics/cash-flow?range=custom', alex);
      expect(bad.statusCode).toBe(400);
      expect(bad.json().error.details.from[0]).toMatch(/start and end/);
      expect(
        (await api.get('/api/analytics/cash-flow?range=custom&from=2026-10-10&to=2026-10-01', alex))
          .statusCode,
      ).toBe(400);
      expect(
        (await api.get('/api/analytics/cash-flow?range=custom&from=2015-01-01&to=2026-01-01', alex))
          .statusCode,
      ).toBe(400);
      expect((await api.get('/api/analytics/cash-flow?range=2w', alex)).statusCode).toBe(400);
    });

    it('works with leap-day and year-boundary ranges', async () => {
      clock = new Date('2024-03-01T12:00:00Z');
      await add({ amount: 100, date: '2024-02-29' });
      const r = (await api.get('/api/analytics/cash-flow?range=7d', alex)).json();
      expect(r.points.map((p: { start: string }) => p.start)).toContain('2024-02-29');
      expect(r.totals.spent).toBe(100);
      clock = new Date('2027-01-03T12:00:00Z');
      const y = (await api.get('/api/analytics/cash-flow?range=7d', alex)).json();
      expect(y.points[0].start).toBe('2026-12-28');
    });
  });

  describe('GET /analytics/categories', () => {
    it('ranks top-level categories, rolls subcategories up and sums to the total', async () => {
      await populate();
      const r = (
        await api.get('/api/analytics/categories?range=custom&from=2026-10-01&to=2026-10-15', alex)
      ).json();
      expect(r.total).toBe(253000);
      expect(r.slices.map((s: { name: string; amount: number }) => [s.name, s.amount])).toEqual([
        ['Housing', 185000],
        ['Food', 68000],
      ]);
      const food = r.slices.find((s: { name: string }) => s.name === 'Food');
      expect(food.children.map((c: { name: string }) => c.name)).toEqual([
        'Groceries',
        'Restaurants',
      ]);
      expect(r.slices.reduce((s: number, x: { amount: number }) => s + x.amount, 0)).toBe(r.total);
      expect(
        r.slices.reduce((s: number, x: { shareBp: number }) => s + x.shareBp, 0),
      ).toBeGreaterThanOrEqual(9998);
    });

    it('a refund shrinks its category; income and transfers never appear', async () => {
      await add({ amount: 10000, categoryId: cat.Shopping, date: '2026-10-03' });
      await add({
        type: 'income',
        isRefund: true,
        amount: 4000,
        categoryId: cat.Shopping,
        date: '2026-10-05',
      });
      await add({ type: 'income', amount: 480000, categoryId: cat.Salary, date: '2026-10-01' });
      const r = (await api.get('/api/analytics/categories?range=30d', alex)).json();
      expect(r.slices).toHaveLength(1);
      expect(r.slices[0]).toMatchObject({ name: 'Shopping', amount: 6000, shareBp: 10000 });
    });

    it('shows uncategorised spending rather than hiding it', async () => {
      await add({ amount: 700, date: '2026-10-03' });
      const r = (await api.get('/api/analytics/categories?range=30d', alex)).json();
      expect(r.slices[0]).toMatchObject({ categoryId: null, name: 'Uncategorised', amount: 700 });
    });

    it('is empty (not an error) when there is no spending', async () => {
      const r = await api.get('/api/analytics/categories?range=7d', alex);
      expect(r.statusCode).toBe(200);
      expect(r.json()).toMatchObject({ total: 0, slices: [] });
    });
  });

  describe('tenant isolation', () => {
    it('never includes another user’s transactions, and ignores their ids in filters', async () => {
      await populate();
      const bea = await api.signUp('bea@example.com', 'Bea');
      const beaAcc = (
        await api.post('/api/accounts', bea, {
          name: 'Bea checking',
          type: 'bank',
          currency: 'USD',
        })
      ).json();
      await api.post('/api/transactions', bea, {
        type: 'expense',
        accountId: beaAcc.id,
        amount: 999999,
        description: 'Bea secret',
        date: '2026-10-02',
      });

      const beaOverview = (await api.get('/api/analytics/overview', bea)).json();
      expect(beaOverview.month.spent).toBe(999999);
      expect(beaOverview.totalBalance).toBe(-999999);

      const alexOverview = (await api.get('/api/analytics/overview', alex)).json();
      expect(alexOverview.month.spent).toBe(253000);

      // Alex asking for Bea's account/category yields nothing, not Bea's data
      const spy = (
        await api.get(`/api/analytics/cash-flow?range=30d&accountId=${beaAcc.id}`, alex)
      ).json();
      expect(spy.totals.spent).toBe(0);
      const cats = (await api.get('/api/categories', bea)).json().categories as {
        id: string;
        name: string;
      }[];
      const beaFood = cats.find((c) => c.name === 'Food')!.id;
      expect(
        (await api.get(`/api/analytics/categories?range=30d&categoryId=${beaFood}`, alex)).json()
          .total,
      ).toBe(0);
    });
  });
});
