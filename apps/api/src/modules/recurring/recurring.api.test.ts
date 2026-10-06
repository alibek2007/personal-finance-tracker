import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApiClient, type ApiClient, type Session } from '../../../test/api-client';
import { createTestApp, resetDb } from '../../../test/helpers';

type Ctx = Awaited<ReturnType<typeof createTestApp>>;
let clock = new Date('2026-10-15T12:00:00Z');

describe('recurring payments API', () => {
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
    checking = (
      await api.post('/api/accounts', alex, {
        name: 'Checking',
        type: 'bank',
        currency: 'USD',
        initialBalance: 1_000_000,
      })
    ).json().id;
    const cats = (await api.get('/api/categories', alex)).json().categories as {
      id: string;
      name: string;
    }[];
    cat = Object.fromEntries(cats.map((c) => [c.name, c.id]));
  });

  const rule = async (over: Record<string, unknown> = {}, s: Session = alex) => {
    const res = await api.post('/api/recurring', s, {
      type: 'expense',
      accountId: checking,
      categoryId: cat.Subscriptions,
      amount: 1599,
      description: 'Netflix',
      frequency: 'monthly',
      nextOccurrence: '2026-10-20',
      ...over,
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json();
  };
  const txs = async () =>
    (await api.get('/api/transactions?limit=100', alex)).json().items as {
      date: string;
      amount: number;
      isRecurring: boolean;
      description: string;
    }[];
  const balance = async () =>
    (await api.get(`/api/accounts/${checking}`, alex)).json().currentBalance as number;
  const advance = (iso: string) => {
    clock = new Date(`${iso}T12:00:00Z`);
  };
  const run = async () => (await api.post('/api/recurring/run', alex)).json().created as number;

  describe('creating', () => {
    it('describes the cadence and what it costs per month and per year', async () => {
      const r = await rule();
      expect(r).toMatchObject({
        description: 'Netflix',
        amount: 1599,
        cadence: 'Monthly',
        nextOccurrence: '2026-10-20',
        isActive: true,
        hasEnded: false,
        monthlyCost: 1599,
        yearlyCost: 19188,
        isSubscription: true,
        blocked: null,
      });
      const week = await rule({ description: 'Gym', frequency: 'weekly', interval: 2 });
      expect(week.cadence).toBe('Every 2 weeks');
    });

    it('records nothing until the date arrives', async () => {
      await rule();
      expect(await txs()).toHaveLength(0);
      expect(await balance()).toBe(1_000_000);
    });

    it('records a payment that is due today straight away', async () => {
      await rule({ nextOccurrence: '2026-10-15' });
      const list = await txs();
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ date: '2026-10-15', amount: 1599, isRecurring: true });
      expect(await balance()).toBe(1_000_000 - 1599);
      const listed = (await api.get('/api/recurring', alex)).json();
      expect(listed.items[0].nextOccurrence).toBe('2026-11-15');
    });

    it('rejects a first payment in the past, a bad end date, and foreign or archived accounts', async () => {
      const base = {
        type: 'expense',
        accountId: checking,
        amount: 500,
        description: 'X',
        frequency: 'monthly',
      };
      const past = await api.post('/api/recurring', alex, {
        ...base,
        nextOccurrence: '2026-10-14',
      });
      expect(past.statusCode).toBe(400);
      expect(past.json().error.details.nextOccurrence).toBeDefined();

      const badEnd = await api.post('/api/recurring', alex, {
        ...base,
        nextOccurrence: '2026-10-20',
        endDate: '2026-10-19',
      });
      expect(badEnd.json().error.details.endDate).toBeDefined();

      const zero = await api.post('/api/recurring', alex, {
        ...base,
        amount: 0,
        nextOccurrence: '2026-10-20',
      });
      expect(zero.statusCode).toBe(400);

      const bea = await api.signUp('bea@example.com', 'Bea');
      const theirs = (
        await api.post('/api/accounts', bea, { name: 'Theirs', type: 'bank', currency: 'USD' })
      ).json().id;
      const foreign = await api.post('/api/recurring', alex, {
        ...base,
        accountId: theirs,
        nextOccurrence: '2026-10-20',
      });
      expect(foreign.json().error.details.accountId).toBeDefined();

      await api.patch(`/api/accounts/${checking}`, alex, { isArchived: true });
      const archived = await api.post('/api/recurring', alex, {
        ...base,
        nextOccurrence: '2026-10-20',
      });
      expect(archived.json().error.details.accountId).toBeDefined();
    });

    it('needs the right kind of category', async () => {
      const res = await api.post('/api/recurring', alex, {
        type: 'expense',
        accountId: checking,
        categoryId: cat.Salary,
        amount: 500,
        description: 'X',
        frequency: 'monthly',
        nextOccurrence: '2026-10-20',
      });
      expect(res.json().error.details.categoryId).toBeDefined();
    });

    it('requires a signed-in user', async () => {
      expect((await api.get('/api/recurring', null)).statusCode).toBe(401);
    });
  });

  describe('turning due payments into transactions', () => {
    it('records a payment once its date arrives, and not again', async () => {
      await rule();
      advance('2026-10-20');
      expect(await run()).toBe(1);
      expect(await run()).toBe(0);
      expect(await txs()).toHaveLength(1);
      expect(await balance()).toBe(1_000_000 - 1599);
      const listed = (await api.get('/api/recurring', alex)).json();
      expect(listed.items[0].nextOccurrence).toBe('2026-11-20');
    });

    it('catches up on every payment missed while nobody opened the app', async () => {
      await rule({ nextOccurrence: '2026-10-20' });
      advance('2027-01-25');
      expect(await run()).toBe(4);
      expect((await txs()).map((t) => t.date).sort()).toEqual([
        '2026-10-20',
        '2026-11-20',
        '2026-12-20',
        '2027-01-20',
      ]);
      expect(await balance()).toBe(1_000_000 - 4 * 1599);
    });

    it('is safe when two runs race', async () => {
      await rule();
      advance('2026-10-20');
      const results = await Promise.all([run(), run(), run()]);
      expect(results.reduce((a, b) => a + b, 0)).toBe(1);
      expect(await txs()).toHaveLength(1);
      expect(await balance()).toBe(1_000_000 - 1599);
    });

    it('is triggered by opening the recurring list and the dashboard', async () => {
      await rule();
      advance('2026-10-21');
      await api.get('/api/recurring', alex);
      expect(await txs()).toHaveLength(1);

      await rule({ description: 'Spotify', nextOccurrence: '2026-10-22', amount: 999 });
      advance('2026-10-23');
      await api.get('/api/analytics/overview', alex);
      expect(await txs()).toHaveLength(2);
    });

    it('keeps the 31st after a short month', async () => {
      await rule({ description: 'Rent', nextOccurrence: '2026-10-31', amount: 100000 });
      advance('2027-03-01');
      await run();
      expect((await txs()).map((t) => t.date).sort()).toEqual([
        '2026-10-31',
        '2026-11-30',
        '2026-12-31',
        '2027-01-31',
        '2027-02-28',
      ]);
    });

    it('records income as income', async () => {
      await rule({
        type: 'income',
        categoryId: cat.Salary,
        description: 'Pay',
        amount: 300000,
        nextOccurrence: '2026-10-15',
      });
      expect(await balance()).toBe(1_300_000);
    });

    it('stops after the end date and marks the payment as ended', async () => {
      const r = await rule({ nextOccurrence: '2026-10-20', endDate: '2026-12-31' });
      advance('2027-03-01');
      expect(await run()).toBe(3);
      const item = (await api.get('/api/recurring', alex)).json().items[0];
      expect(item).toMatchObject({ id: r.id, isActive: false, hasEnded: true });
    });

    it('holds a payment whose account was archived instead of failing, and says why', async () => {
      await rule();
      await api.patch(`/api/accounts/${checking}`, alex, { isArchived: true });
      advance('2026-10-25');
      expect(await run()).toBe(0);
      const item = (await api.get('/api/recurring', alex)).json().items[0];
      expect(item.blocked).toBe('account_archived');
      expect(await txs()).toHaveLength(0);

      await api.patch(`/api/accounts/${checking}`, alex, { isArchived: false });
      expect(await run()).toBe(1);
    });

    it('can run for every user at once (the background job)', async () => {
      await rule({ nextOccurrence: '2026-10-16' });
      const bea = await api.signUp('bea@example.com', 'Bea');
      const beaAcc = (
        await api.post('/api/accounts', bea, { name: 'Main', type: 'bank', currency: 'USD' })
      ).json().id;
      await rule({ accountId: beaAcc, categoryId: undefined, nextOccurrence: '2026-10-16' }, bea);
      advance('2026-10-17');
      const result = await ctx.app.recurring.materializeAll();
      expect(result.created).toBe(2);
      expect(await txs()).toHaveLength(1);
      expect(((await api.get('/api/transactions', bea)).json().items as unknown[]).length).toBe(1);
    });
  });

  describe('editing, pausing and deleting', () => {
    it('changes the amount for future payments only', async () => {
      const r = await rule({ nextOccurrence: '2026-10-15' });
      const res = await api.patch(`/api/recurring/${r.id}`, alex, { amount: 1799 });
      expect(res.json()).toMatchObject({ amount: 1799, monthlyCost: 1799 });
      expect((await txs())[0]?.amount).toBe(1599);
      advance('2026-11-15');
      await run();
      expect((await txs()).map((t) => t.amount).sort()).toEqual([1599, 1799]);
    });

    it('re-anchors on the date you choose', async () => {
      const r = await rule();
      const res = await api.patch(`/api/recurring/${r.id}`, alex, { nextOccurrence: '2026-10-28' });
      expect(res.json().nextOccurrence).toBe('2026-10-28');
      advance('2026-11-30');
      await run();
      expect((await txs()).map((t) => t.date)).toEqual(['2026-11-28', '2026-10-28']);
    });

    it('pausing stops payments; resuming skips what was missed', async () => {
      const r = await rule({ nextOccurrence: '2026-10-20' });
      const paused = await api.patch(`/api/recurring/${r.id}`, alex, { isActive: false });
      expect(paused.json().isActive).toBe(false);
      advance('2026-12-25');
      expect(await run()).toBe(0);
      expect(await txs()).toHaveLength(0);

      const resumed = await api.patch(`/api/recurring/${r.id}`, alex, { isActive: true });
      expect(resumed.json()).toMatchObject({ isActive: true, nextOccurrence: '2027-01-20' });
      expect(await txs()).toHaveLength(0);
    });

    it('refuses to resume a payment past its end date', async () => {
      const r = await rule({ nextOccurrence: '2026-10-20', endDate: '2026-11-30' });
      await api.patch(`/api/recurring/${r.id}`, alex, { isActive: false });
      advance('2026-12-25');
      const res = await api.patch(`/api/recurring/${r.id}`, alex, { isActive: true });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('ended');
    });

    it('deleting keeps the transactions it already recorded', async () => {
      const r = await rule({ nextOccurrence: '2026-10-15' });
      expect((await api.delete(`/api/recurring/${r.id}`, alex)).statusCode).toBe(200);
      const list = await txs();
      expect(list).toHaveLength(1);
      expect(list[0]?.isRecurring).toBe(true);
      expect((await api.get('/api/recurring', alex)).json().items).toEqual([]);
      expect((await api.delete(`/api/recurring/${r.id}`, alex)).statusCode).toBe(404);
    });

    it('rejects an empty update', async () => {
      const r = await rule();
      expect((await api.patch(`/api/recurring/${r.id}`, alex, {})).statusCode).toBe(400);
    });
  });

  describe('totals', () => {
    it('adds up monthly and yearly costs, with subscriptions separated', async () => {
      await rule({ amount: 1599 });
      await rule({ description: 'iCloud', amount: 299, frequency: 'monthly' });
      await rule({ description: 'Domain', amount: 1200, frequency: 'yearly' });
      await rule({
        description: 'Rent',
        amount: 120000,
        categoryId: cat.Housing,
      });
      await rule({
        type: 'income',
        description: 'Salary',
        categoryId: cat.Salary,
        amount: 400000,
      });
      const { totals } = (await api.get('/api/recurring', alex)).json();
      expect(totals).toMatchObject({
        currency: 'USD',
        activeCount: 5,
        subscriptionsCount: 3,
        subscriptionsMonthly: 1599 + 299 + 100,
        subscriptionsYearly: 19188 + 3588 + 1200,
        monthlyExpenses: 1599 + 299 + 100 + 120000,
        monthlyIncome: 400000,
      });
    });

    it('leaves paused payments out and never mixes currencies', async () => {
      const a = await rule();
      await api.patch(`/api/recurring/${a.id}`, alex, { isActive: false });
      const eur = (
        await api.post('/api/accounts', alex, { name: 'Euro', type: 'bank', currency: 'EUR' })
      ).json().id;
      await rule({ accountId: eur, description: 'Berlin gym', amount: 3000 });
      const body = (await api.get('/api/recurring', alex)).json();
      expect(body.totals).toBeNull();
      expect(body.excludedCurrencies).toEqual(['EUR']);
    });

    it('shows up in the dashboard insights', async () => {
      await rule({ amount: 1599 });
      await rule({ description: 'Spotify', amount: 1099, nextOccurrence: '2026-10-22' });
      const overview = (await api.get('/api/analytics/overview', alex)).json();
      expect(JSON.stringify(overview)).toContain(
        'subscriptions cost about $26.98 a month ($323.76 a year)',
      );
    });
  });

  describe('coming up', () => {
    it('expands upcoming payments within a range', async () => {
      await rule({ nextOccurrence: '2026-10-20' });
      await rule({
        description: 'Gym',
        frequency: 'weekly',
        amount: 1000,
        nextOccurrence: '2026-10-16',
      });
      const res = await api.get('/api/recurring/occurrences?from=2026-10-15&to=2026-11-30', alex);
      const o = res.json().occurrences as { date: string; description: string }[];
      expect(o.filter((x) => x.description === 'Netflix').map((x) => x.date)).toEqual([
        '2026-10-20',
        '2026-11-20',
      ]);
      expect(o.filter((x) => x.description === 'Gym')).toHaveLength(7);
      expect(o.map((x) => x.date)).toEqual([...o.map((x) => x.date)].sort());
    });

    it('skips paused rules and stops at the end date', async () => {
      const paused = await rule({ description: 'Old' });
      await api.patch(`/api/recurring/${paused.id}`, alex, { isActive: false });
      await rule({ description: 'Short', nextOccurrence: '2026-10-20', endDate: '2026-11-25' });
      const o = (
        await api.get('/api/recurring/occurrences?from=2026-10-15&to=2027-03-01', alex)
      ).json().occurrences as { description: string }[];
      expect(o.map((x) => x.description)).toEqual(['Short', 'Short']);
    });

    it('rejects ranges that are backwards or too long', async () => {
      expect(
        (await api.get('/api/recurring/occurrences?from=2026-11-01&to=2026-10-01', alex))
          .statusCode,
      ).toBe(400);
      expect(
        (await api.get('/api/recurring/occurrences?from=2026-01-01&to=2027-12-31', alex))
          .statusCode,
      ).toBe(400);
    });
  });

  describe('privacy', () => {
    it("cannot see, change or delete someone else's payments", async () => {
      const r = await rule();
      const bea = await api.signUp('bea@example.com', 'Bea');
      expect((await api.get('/api/recurring', bea)).json().items).toEqual([]);
      expect((await api.patch(`/api/recurring/${r.id}`, bea, { amount: 1 })).statusCode).toBe(404);
      expect((await api.delete(`/api/recurring/${r.id}`, bea)).statusCode).toBe(404);
      expect(
        (await api.get('/api/recurring/occurrences?from=2026-10-15&to=2026-12-01', bea)).json()
          .occurrences,
      ).toEqual([]);
    });
  });
});
