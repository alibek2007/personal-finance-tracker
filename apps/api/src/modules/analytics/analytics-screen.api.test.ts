import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApiClient, type ApiClient, type Session } from '../../../test/api-client';
import { createTestApp, resetDb } from '../../../test/helpers';

type Ctx = Awaited<ReturnType<typeof createTestApp>>;
const clock = new Date('2026-10-15T12:00:00Z'); // Thursday

describe('analytics screen endpoints', () => {
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
    await resetDb(ctx.db);
    alex = await api.signUp('alex@example.com', 'Alex');
    checking = (
      await api.post('/api/accounts', alex, {
        name: 'Checking',
        type: 'bank',
        currency: 'USD',
        initialBalance: 100000,
      })
    ).json().id;
    const cats = (await api.get('/api/categories', alex)).json().categories as {
      id: string;
      name: string;
    }[];
    cat = Object.fromEntries(cats.map((c) => [c.name, c.id]));
  });

  const add = async (body: Record<string, unknown>, account = checking) => {
    const res = await api.post('/api/transactions', alex, {
      type: 'expense',
      accountId: account,
      description: 'x',
      ...body,
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json();
  };
  const get = async (url: string, s: Session | null = alex) => (await api.get(url, s)).json();
  const RANGE = 'range=custom&from=2026-10-01&to=2026-10-15';

  describe('GET /analytics/summary', () => {
    beforeEach(async () => {
      await add({ type: 'income', amount: 480000, categoryId: cat.Salary, date: '2026-10-01' });
      await add({ amount: 100000, categoryId: cat.Rent, date: '2026-10-03' });
      await add({ amount: 40000, categoryId: cat.Shopping, date: '2026-09-20' }); // inside the previous 15 days
      await add({ amount: 99999, categoryId: cat.Shopping, date: '2026-09-05' }); // before it
    });

    it('compares a range with the equal-length period immediately before', async () => {
      const s = await get(`/api/analytics/summary?${RANGE}`);
      expect(s.current).toMatchObject({
        from: '2026-10-01',
        to: '2026-10-15',
        income: 480000,
        spent: 100000,
        saved: 380000,
      });
      expect(s.previous).toMatchObject({
        from: '2026-09-16',
        to: '2026-09-30',
        income: 0,
        spent: 40000,
        saved: -40000,
      });
      expect(s.changes).toEqual({ incomeBp: null, spentBp: 15000, savedBp: 105000 });
    });

    it('reports when the user’s records begin, so thin comparisons can be flagged', async () => {
      expect((await get(`/api/analytics/summary?${RANGE}`)).dataStartsOn).toBe('2026-09-05');
      await resetDb(ctx.db);
      alex = await api.signUp('new@example.com', 'New');
      expect((await get(`/api/analytics/summary?${RANGE}`)).dataStartsOn).toBeNull();
    });

    it('presets work too, and honour the account and type filters', async () => {
      expect((await get('/api/analytics/summary?range=7d')).current).toMatchObject({
        from: '2026-10-09',
        to: '2026-10-15',
        spent: 0,
      });
      const income = await get(`/api/analytics/summary?${RANGE}&type=income`);
      expect(income.current).toMatchObject({ income: 480000, spent: 0 });
      const other = (
        await api.post('/api/accounts', alex, { name: 'Cash', type: 'cash', currency: 'USD' })
      ).json().id;
      expect(
        (await get(`/api/analytics/summary?${RANGE}&accountId=${other}`)).current,
      ).toMatchObject({ income: 0, spent: 0 });
    });

    it('lists other currencies it left out', async () => {
      const kzt = (
        await api.post('/api/accounts', alex, {
          name: 'Tenge',
          type: 'bank',
          currency: 'KZT',
          initialBalance: 90000000,
        })
      ).json().id;
      await add({ amount: 5_000_000, date: '2026-10-04' }, kzt);
      const s = await get(`/api/analytics/summary?${RANGE}`);
      expect(s.excludedCurrencies).toEqual(['KZT']);
      expect(s.current.spent).toBe(100000);
    });
  });

  describe('GET /analytics/spending-trend', () => {
    it('splits spending by the biggest top-level categories and groups the rest', async () => {
      await add({ amount: 185000, categoryId: cat.Rent, date: '2026-10-01' }); // Housing
      await add({ amount: 30000, categoryId: cat.Groceries, date: '2026-10-05' }); // Food
      await add({ amount: 8000, categoryId: cat.Restaurants, date: '2026-10-10' }); // Food
      await add({ amount: 400, categoryId: cat.Coffee, date: '2026-10-10' }); // Food
      await add({ amount: 5000, categoryId: cat.Shopping, date: '2026-10-11' });
      await add({ amount: 3000, categoryId: cat.Health, date: '2026-10-12' });
      await add({ amount: 2000, categoryId: cat.Travel, date: '2026-10-13' });
      await add({ amount: 1000, categoryId: cat.Education, date: '2026-10-13' });
      await add({ amount: 500, categoryId: cat.Other, date: '2026-10-14' });
      const t = await get(`/api/analytics/spending-trend?${RANGE}`);
      expect(t.unit).toBe('week');
      expect(t.series.map((s: { name: string }) => s.name)).toEqual([
        'Housing',
        'Food',
        'Shopping',
        'Health',
        'Travel',
        'Everything else',
      ]);
      const total = t.points.reduce((s: number, p: { total: number }) => s + p.total, 0);
      expect(total).toBe(185000 + 38400 + 5000 + 3000 + 2000 + 1000 + 500);
      for (const p of t.points) {
        expect(Object.values(p.values as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(
          p.total,
        );
      }
    });

    it('every period’s total matches the cash-flow chart for the same range', async () => {
      await add({ amount: 5000, categoryId: cat.Shopping, date: '2026-10-03' });
      await api.post('/api/transactions', alex, {
        type: 'income',
        isRefund: true,
        accountId: checking,
        amount: 1500,
        categoryId: cat.Shopping,
        description: 'Return',
        date: '2026-10-04',
      });
      await add({ amount: 700, date: '2026-10-10' });
      const trend = await get(`/api/analytics/spending-trend?${RANGE}`);
      const flow = await get(`/api/analytics/cash-flow?${RANGE}`);
      expect(trend.points.map((p: { total: number }) => p.total)).toEqual(
        flow.points.map((p: { expenses: number }) => p.expenses),
      );
    });

    it('is empty without spending', async () => {
      const t = await get(`/api/analytics/spending-trend?${RANGE}`);
      expect(t.series).toEqual([]);
      expect(t.points.every((p: { total: number }) => p.total === 0)).toBe(true);
    });
  });

  describe('GET /analytics/monthly', () => {
    beforeEach(async () => {
      await add({ amount: 200000, date: '2026-08-05' });
      await add({ amount: 250000, date: '2026-09-05' });
      await add({ amount: 10000, date: '2026-09-20' });
      await add({ amount: 300000, date: '2026-10-03' });
      await add({ type: 'income', amount: 480000, date: '2026-10-01' });
    });

    it('lists whole months with change versus the month before, and the current month like-for-like', async () => {
      const m = await get('/api/analytics/monthly?months=3');
      expect(m.months.map((r: { month: string }) => r.month)).toEqual([
        '2026-08',
        '2026-09',
        '2026-10',
      ]);
      expect(m.months[1]).toMatchObject({ spent: 260000, partial: false, spentChangeBp: 3000 });
      expect(m.months[2]).toMatchObject({
        spent: 300000,
        income: 480000,
        partial: true,
        to: '2026-10-15',
      });
      expect(m.months[2].spentChangeBp).toBe(2000); // Oct 1-15 vs Sep 1-15 (250,000)
    });

    it('defaults to twelve months and validates the count', async () => {
      expect((await get('/api/analytics/monthly')).months).toHaveLength(12);
      expect((await api.get('/api/analytics/monthly?months=1', alex)).statusCode).toBe(400);
      expect((await api.get('/api/analytics/monthly?months=25', alex)).statusCode).toBe(400);
    });

    it('filters by category', async () => {
      await add({ amount: 9000, categoryId: cat.Coffee, date: '2026-09-06' });
      const m = await get(`/api/analytics/monthly?months=2&categoryId=${cat.Food}`);
      expect(m.months[0].spent).toBe(9000);
      expect(m.months[1].spent).toBe(0);
    });
  });

  describe('GET /analytics/balances', () => {
    it('tracks net worth and each account through time, debts as negatives', async () => {
      const cash = (
        await api.post('/api/accounts', alex, { name: 'Cash', type: 'cash', currency: 'USD' })
      ).json().id;
      await api.post('/api/accounts', alex, {
        name: 'Visa',
        type: 'credit_card',
        currency: 'USD',
        initialBalance: -20000,
      });
      await add({ type: 'income', amount: 50000, date: '2026-09-20' }); // before the window: part of the opening position
      await add({ amount: 10000, date: '2026-10-03' });
      await add({ type: 'transfer', amount: 30000, transferAccountId: cash, date: '2026-10-12' });
      const b = await get(`/api/analytics/balances?${RANGE}`);
      expect(b.unit).toBe('week');
      expect(b.points.map((p: { date: string }) => p.date)).toEqual([
        '2026-10-04',
        '2026-10-11',
        '2026-10-15',
      ]);
      expect(b.points.map((p: { total: number }) => p.total)).toEqual([120000, 120000, 120000]); // the transfer changes nothing
      const last = b.points.at(-1);
      const byName = Object.fromEntries(
        b.accounts.map((a: { id: string; name: string }) => [a.name, last.byAccount[a.id]]),
      );
      expect(byName).toEqual({ Checking: 110000, Cash: 30000, Visa: -20000 });
    });

    it('the last point equals the live account balances', async () => {
      await add({ amount: 12345, date: '2026-10-14' });
      const b = await get(`/api/analytics/balances?${RANGE}`);
      const accounts = (await get('/api/accounts')).accounts as {
        id: string;
        currentBalance: number;
      }[];
      expect(b.points.at(-1).total).toBe(accounts.reduce((s, a) => s + a.currentBalance, 0));
    });

    it('can focus on one account, and reports other currencies as excluded', async () => {
      const kzt = (
        await api.post('/api/accounts', alex, {
          name: 'Tenge',
          type: 'bank',
          currency: 'KZT',
          initialBalance: 5000000,
        })
      ).json().id;
      const all = await get(`/api/analytics/balances?${RANGE}`);
      expect(all.excludedCurrencies).toEqual(['KZT']);
      expect(all.accounts.map((a: { name: string }) => a.name)).toEqual(['Checking']);
      const only = await get(`/api/analytics/balances?${RANGE}&accountId=${checking}`);
      expect(only.points.at(-1).total).toBe(100000);
      const foreign = await get(`/api/analytics/balances?${RANGE}&accountId=${kzt}`);
      expect(foreign.accounts).toEqual([]);
      expect(foreign.excludedCurrencies).toEqual(['KZT']);
    });

    it('hides an archived account that held nothing', async () => {
      const unused = (
        await api.post('/api/accounts', alex, { name: 'Old', type: 'bank', currency: 'USD' })
      ).json().id;
      await api.patch(`/api/accounts/${unused}`, alex, { isArchived: true });
      expect(
        (await get(`/api/analytics/balances?${RANGE}`)).accounts.map(
          (a: { name: string }) => a.name,
        ),
      ).toEqual(['Checking']);
    });
  });

  describe('GET /analytics/savings', () => {
    it('shows money set aside over time and where each active goal stands', async () => {
      const laptop = (
        await api.post('/api/goals', alex, { name: 'Laptop', targetAmount: 200000 })
      ).json();
      const trip = (
        await api.post('/api/goals', alex, { name: 'Trip', targetAmount: 100000 })
      ).json();
      await api.post(`/api/goals/${laptop.id}/contributions`, alex, {
        amount: 30000,
        date: '2026-09-10',
      });
      await api.post(`/api/goals/${laptop.id}/contributions`, alex, {
        amount: 20000,
        date: '2026-10-05',
      });
      await api.post(`/api/goals/${trip.id}/contributions`, alex, {
        amount: 10000,
        date: '2026-10-08',
      });
      const archived = (
        await api.post('/api/goals', alex, { name: 'Old', targetAmount: 1000 })
      ).json();
      await api.post(`/api/goals/${archived.id}/contributions`, alex, {
        amount: 500,
        date: '2026-10-01',
      });
      await api.patch(`/api/goals/${archived.id}`, alex, { isArchived: true });

      const s = await get('/api/analytics/savings?range=custom&from=2026-09-01&to=2026-10-15');
      expect(s.points.at(-1).total).toBe(60000); // 30,000 + 20,000 + 10,000; the archived goal is left out
      expect(s.points[0].total).toBe(0);
      const totals = s.points.map((p: { total: number }) => p.total);
      expect([...totals].sort((a: number, b: number) => a - b)).toEqual(totals); // never goes backwards without withdrawals
      expect(
        s.goals.map((g: { name: string; current: number; progressBp: number }) => [
          g.name,
          g.current,
          g.progressBp,
        ]),
      ).toEqual([
        ['Laptop', 50000, 2500],
        ['Trip', 10000, 1000],
      ]);
    });

    it('is empty and calm with no goals', async () => {
      const s = await get('/api/analytics/savings?range=3m');
      expect(s.goals).toEqual([]);
      expect(s.points.every((p: { total: number }) => p.total === 0)).toBe(true);
    });
  });

  describe('GET /analytics/budget-performance', () => {
    it('shows each monthly budget month by month, and counts the months you stayed within all of them', async () => {
      await api.post('/api/budgets', alex, {
        categoryId: cat.Food,
        amount: 50000,
        startDate: '2026-08-01',
      });
      await api.post('/api/budgets', alex, {
        categoryId: cat.Shopping,
        amount: 10000,
        startDate: '2026-09-01',
      });
      await add({ amount: 30000, categoryId: cat.Groceries, date: '2026-08-10' }); // Aug: Food ok
      await add({ amount: 60000, categoryId: cat.Groceries, date: '2026-09-10' }); // Sep: Food over
      await add({ amount: 5000, categoryId: cat.Shopping, date: '2026-09-12' }); //   Sep: Shopping ok
      await add({ amount: 20000, categoryId: cat.Restaurants, date: '2026-10-05' }); // Oct (partial): Food so far

      const p = await get('/api/analytics/budget-performance');
      expect(p.months).toHaveLength(6);
      expect(p.months[0]).toMatchObject({ from: '2026-05-01', partial: false });
      expect(p.months[5]).toMatchObject({ from: '2026-10-01', to: '2026-10-15', partial: true });

      const food = p.budgets.find((b: { name: string }) => b.name === 'Food');
      expect(food.results.slice(0, 3)).toEqual([null, null, null]); // the budget did not exist yet
      expect(food.results[3]).toEqual({ spent: 30000, over: false });
      expect(food.results[4]).toEqual({ spent: 60000, over: true });
      expect(food.results[5]).toEqual({ spent: 20000, over: false });
      const shop = p.budgets.find((b: { name: string }) => b.name === 'Shopping');
      expect(shop.results[3]).toBeNull();
      expect(shop.results[4]).toEqual({ spent: 5000, over: false });

      // Completed months with a budget: Aug (Food only, kept) and Sep (Food broken). Oct is still in progress.
      expect(p.monthsEvaluated).toBe(2);
      expect(p.monthsWithinBudget).toBe(1);
    });

    it('is empty without budgets', async () => {
      const p = await get('/api/analytics/budget-performance');
      expect(p).toMatchObject({ budgets: [], monthsEvaluated: 0, monthsWithinBudget: 0 });
    });
  });

  describe('security', () => {
    it('another user never sees your numbers in any of them', async () => {
      await add({ amount: 777777, categoryId: cat.Shopping, date: '2026-10-03' });
      const bea = await api.signUp('bea@example.com', 'Bea');
      for (const url of [
        `/api/analytics/summary?${RANGE}`,
        `/api/analytics/spending-trend?${RANGE}`,
        '/api/analytics/monthly?months=3',
        `/api/analytics/balances?${RANGE}`,
        `/api/analytics/savings?${RANGE}`,
        '/api/analytics/budget-performance',
      ]) {
        const body = JSON.stringify(await get(url, bea));
        expect(body, url).not.toContain('777777');
        expect(body, url).not.toContain('Checking');
      }
    });

    it('all of them require a session', async () => {
      for (const url of [
        'summary',
        'spending-trend',
        'monthly',
        'balances',
        'savings',
        'budget-performance',
      ]) {
        expect((await api.get(`/api/analytics/${url}`, null)).statusCode, url).toBe(401);
      }
    });
  });
});
