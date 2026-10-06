import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApiClient, type ApiClient, type Session } from '../../../test/api-client';
import { createTestApp, resetDb } from '../../../test/helpers';

type Ctx = Awaited<ReturnType<typeof createTestApp>>;

// Thursday 15 October 2026
let clock = new Date('2026-10-15T12:00:00Z');

describe('budgets API', () => {
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

  const spend = async (
    amount: number,
    category: string,
    date: string,
    extra: Record<string, unknown> = {},
  ) => {
    const res = await api.post('/api/transactions', alex, {
      type: 'expense',
      accountId: checking,
      amount,
      categoryId: cat[category],
      description: category,
      date,
      ...extra,
    });
    expect(res.statusCode, res.body).toBe(201);
  };
  const budget = async (category: string, amount: number, extra: Record<string, unknown> = {}) => {
    const res = await api.post('/api/budgets', alex, {
      categoryId: cat[category],
      amount,
      ...extra,
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json();
  };
  const list = async (s: Session = alex) => (await api.get('/api/budgets', s)).json();

  describe('creating and reading', () => {
    it('starts a monthly budget for this month with sensible defaults', async () => {
      const b = await budget('Food', 50000);
      expect(b).toMatchObject({
        categoryName: 'Food',
        amount: 50000,
        currency: 'USD',
        period: 'monthly',
        alertThreshold: 80,
        periodFrom: '2026-10-01',
        periodTo: '2026-10-31',
        lifecycle: 'active',
        spent: 0,
        remaining: 50000,
        usedBp: 0,
        status: 'ok',
        headline: '$500 left',
        detail: 'Nothing spent yet.',
        daysTotal: 31,
        daysElapsed: 15,
        daysRemaining: 16,
      });
    });

    it('counts a parent category and all its subcategories, but a subcategory budget only its own', async () => {
      await spend(20000, 'Groceries', '2026-10-03');
      await spend(8000, 'Restaurants', '2026-10-08');
      await spend(1000, 'Coffee', '2026-10-09');
      const food = await budget('Food', 100000);
      const coffee = await budget('Coffee', 5000);
      expect(food.spent).toBe(29000);
      expect(coffee).toMatchObject({ spent: 1000, parentCategoryName: 'Food' });
      expect((await list()).budgets.find((b: { id: string }) => b.id === food.id).spent).toBe(
        29000,
      );
    });

    it('refunds reduce spending; transfers, income and other currencies never count', async () => {
      const sav = (
        await api.post('/api/accounts', alex, { name: 'Savings', type: 'savings', currency: 'USD' })
      ).json().id;
      const kzt = (
        await api.post('/api/accounts', alex, {
          name: 'Tenge',
          type: 'bank',
          currency: 'KZT',
          initialBalance: 100_000_000,
        })
      ).json().id;
      await spend(10000, 'Shopping', '2026-10-02');
      await api.post('/api/transactions', alex, {
        type: 'income',
        isRefund: true,
        accountId: checking,
        amount: 4000,
        categoryId: cat.Shopping,
        description: 'Return',
        date: '2026-10-05',
      });
      await api.post('/api/transactions', alex, {
        type: 'transfer',
        accountId: checking,
        transferAccountId: sav,
        amount: 99999,
        description: 'move',
        date: '2026-10-05',
      });
      await api.post('/api/transactions', alex, {
        type: 'expense',
        accountId: kzt,
        amount: 9_000_000,
        categoryId: cat.Shopping,
        description: 'KZT spend',
        date: '2026-10-06',
      });
      const b = await budget('Shopping', 20000);
      expect(b.spent).toBe(6000);
    });

    it('only spending inside the current period, up to today, counts', async () => {
      await spend(9999, 'Shopping', '2026-09-30'); // last month
      await spend(1000, 'Shopping', '2026-10-01');
      await spend(2000, 'Shopping', '2026-10-31'); // dated in the future: counts once that day arrives
      expect((await budget('Shopping', 20000)).spent).toBe(1000);
      clock = new Date('2026-10-31T12:00:00Z');
      expect((await list()).budgets[0].spent).toBe(3000);
    });
  });

  describe('status, pace and projection', () => {
    it('warns when the pace points past the limit, and says by how much', async () => {
      await spend(20000, 'Groceries', '2026-10-03');
      await spend(8000, 'Restaurants', '2026-10-08');
      await spend(7000, 'Groceries', '2026-10-12');
      const b = await budget('Food', 50000);
      expect(b).toMatchObject({
        spent: 35000,
        status: 'at_risk',
        projectedSpent: 72333,
        projectedOver: 22333,
      });
      expect(b.detail).toBe('At your current pace, you may exceed this budget by $223.');
    });

    it('does not extrapolate a single large bill (rent) into nonsense', async () => {
      await spend(185000, 'Rent', '2026-10-01');
      const b = await budget('Rent', 185000);
      expect(b.projectedSpent).toBeNull();
      expect(b.status).toBe('warning'); // 100% used, but not over
    });

    it('reports overspending plainly', async () => {
      await spend(30000, 'Shopping', '2026-10-02');
      await spend(30000, 'Shopping', '2026-10-09');
      const b = await budget('Shopping', 50000);
      expect(b).toMatchObject({
        status: 'over',
        remaining: -10000,
        headline: 'Over by $100',
        projectedSpent: null,
      });
    });

    it('honours the alert threshold', async () => {
      await spend(6000, 'Shopping', '2026-10-02');
      expect((await budget('Shopping', 10000, { alertThreshold: 50 })).status).toBe('warning');
    });

    it('is exact on the last day of the month and resets on the 1st', async () => {
      await spend(7000, 'Shopping', '2026-10-31');
      await budget('Shopping', 10000, { startDate: '2026-10-01' });
      clock = new Date('2026-10-31T12:00:00Z');
      const last = (await list()).budgets[0];
      expect(last).toMatchObject({
        daysRemaining: 0,
        spent: 7000,
        detail: 'Last day of this period.',
      });
      clock = new Date('2026-11-01T12:00:00Z');
      const fresh = (await list()).budgets[0];
      expect(fresh).toMatchObject({
        periodFrom: '2026-11-01',
        spent: 0,
        remaining: 10000,
        status: 'ok',
      });
    });
  });

  describe('weekly and yearly periods', () => {
    it('weekly runs Monday to Sunday: Sunday belongs to the earlier week', async () => {
      await spend(1000, 'Coffee', '2026-10-11'); // Sunday, previous week
      await spend(2000, 'Coffee', '2026-10-12'); // Monday
      await spend(3000, 'Coffee', '2026-10-14');
      const b = await budget('Coffee', 10000, { period: 'weekly' });
      expect(b).toMatchObject({
        periodFrom: '2026-10-12',
        periodTo: '2026-10-18',
        spent: 5000,
        daysTotal: 7,
      });
    });

    it('a week that spans two months counts both sides', async () => {
      clock = new Date('2026-10-01T12:00:00Z');
      await spend(4000, 'Coffee', '2026-09-30');
      await spend(1500, 'Coffee', '2026-10-01');
      const b = await budget('Coffee', 10000, { period: 'weekly', startDate: '2026-09-28' });
      expect(b).toMatchObject({ periodFrom: '2026-09-28', periodTo: '2026-10-04', spent: 5500 });
    });

    it('yearly covers the calendar year', async () => {
      await spend(50000, 'Travel', '2026-02-10');
      await spend(30000, 'Travel', '2026-09-10');
      await spend(99999, 'Travel', '2025-12-31');
      const b = await budget('Travel', 300000, { period: 'yearly', startDate: '2026-01-01' });
      expect(b).toMatchObject({
        periodFrom: '2026-01-01',
        periodTo: '2026-12-31',
        spent: 80000,
        daysTotal: 365,
      });
    });

    it('February in a leap year has 29 days', async () => {
      clock = new Date('2024-02-10T12:00:00Z');
      const b = await budget('Shopping', 10000);
      expect(b).toMatchObject({ periodTo: '2024-02-29', daysTotal: 29 });
    });
  });

  describe('rules', () => {
    it('only expense categories can be budgeted', async () => {
      const income = await api.post('/api/budgets', alex, { categoryId: cat.Salary, amount: 1000 });
      expect(income.statusCode).toBe(400);
      expect(income.json().error.details.categoryId[0]).toMatch(/expense category/);
    });

    it('rejects archived categories, unknown categories, zero amounts and silly thresholds', async () => {
      await api.patch(`/api/categories/${cat.Health}`, alex, { isArchived: true });
      expect(
        (await api.post('/api/budgets', alex, { categoryId: cat.Health, amount: 1000 })).statusCode,
      ).toBe(400);
      expect(
        (await api.post('/api/budgets', alex, { categoryId: 'nope', amount: 1000 })).statusCode,
      ).toBe(400);
      expect(
        (await api.post('/api/budgets', alex, { categoryId: cat.Food, amount: 0 })).statusCode,
      ).toBe(400);
      expect(
        (await api.post('/api/budgets', alex, { categoryId: cat.Food, amount: 12.5 })).statusCode,
      ).toBe(400);
      expect(
        (
          await api.post('/api/budgets', alex, {
            categoryId: cat.Food,
            amount: 1000,
            alertThreshold: 0,
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await api.post('/api/budgets', alex, {
            categoryId: cat.Food,
            amount: 1000,
            alertThreshold: 101,
          })
        ).statusCode,
      ).toBe(400);
    });

    it('one live budget per category and period, but weekly and monthly can coexist', async () => {
      await budget('Food', 50000);
      const dup = await api.post('/api/budgets', alex, { categoryId: cat.Food, amount: 1 + 1000 });
      expect(dup.statusCode).toBe(409);
      expect(dup.json().error.code).toBe('budget_exists');
      expect(
        (
          await api.post('/api/budgets', alex, {
            categoryId: cat.Food,
            amount: 12000,
            period: 'weekly',
          })
        ).statusCode,
      ).toBe(201);
    });

    it('a finished budget does not block a new one', async () => {
      const old = await budget('Food', 50000);
      await api.patch(`/api/budgets/${old.id}`, alex, { endDate: '2026-10-15' });
      clock = new Date('2026-10-16T12:00:00Z');
      expect((await list()).budgets[0].lifecycle).toBe('ended');
      expect(
        (await api.post('/api/budgets', alex, { categoryId: cat.Food, amount: 60000 })).statusCode,
      ).toBe(201);
    });

    it('a budget with a future start is "upcoming"', async () => {
      const b = await budget('Food', 50000, { startDate: '2026-12-01' });
      expect(b.lifecycle).toBe('upcoming');
    });
  });

  describe('editing and deleting', () => {
    it('changing the limit recalculates immediately', async () => {
      await spend(40000, 'Shopping', '2026-10-02');
      const b = await budget('Shopping', 50000);
      expect(b.usedBp).toBe(8000);
      const raised = (await api.patch(`/api/budgets/${b.id}`, alex, { amount: 100000 })).json();
      expect(raised).toMatchObject({ amount: 100000, usedBp: 4000, remaining: 60000 });
    });

    it('the category cannot be changed by an update', async () => {
      const b = await budget('Shopping', 50000);
      const res = await api.patch(`/api/budgets/${b.id}`, alex, {
        amount: 60000,
        categoryId: cat.Food,
      });
      expect(res.json().categoryName).toBe('Shopping');
    });

    it('moving to a period that already has a budget is a conflict', async () => {
      const monthly = await budget('Food', 50000);
      await budget('Food', 12000, { period: 'weekly' });
      expect(
        (await api.patch(`/api/budgets/${monthly.id}`, alex, { period: 'weekly' })).statusCode,
      ).toBe(409);
    });

    it('an end date before the start is refused; an empty update is refused', async () => {
      const b = await budget('Food', 50000, { startDate: '2026-10-10' });
      expect(
        (await api.patch(`/api/budgets/${b.id}`, alex, { endDate: '2026-10-01' })).statusCode,
      ).toBe(400);
      expect((await api.patch(`/api/budgets/${b.id}`, alex, {})).statusCode).toBe(400);
    });

    it('deleting removes it, and a category with a budget cannot be deleted', async () => {
      const b = await budget('Shopping', 50000);
      const blocked = await api.delete(`/api/categories/${cat.Shopping}`, alex);
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json().error.code).toBe('has_budgets');
      expect((await api.delete(`/api/budgets/${b.id}`, alex)).statusCode).toBe(200);
      expect((await list()).budgets).toEqual([]);
      expect((await api.get(`/api/budgets/${b.id}`, alex)).statusCode).toBe(404);
    });
  });

  describe('summary and history', () => {
    it('totals only active monthly budgets', async () => {
      await spend(20000, 'Groceries', '2026-10-03');
      await spend(5000, 'Shopping', '2026-10-04');
      await budget('Food', 50000);
      await budget('Shopping', 30000);
      await budget('Coffee', 5000, { period: 'weekly' });
      await budget('Travel', 100000, { period: 'yearly' });
      const { monthly } = await list();
      expect(monthly).toEqual({ currency: 'USD', budgeted: 80000, spent: 25000, count: 2 });
    });

    it('no summary when there are no monthly budgets', async () => {
      expect((await list()).monthly).toBeNull();
    });

    it('detail shows how the last six months went', async () => {
      await spend(60000, 'Shopping', '2026-09-10'); // over
      await spend(10000, 'Shopping', '2026-08-10'); // under
      await spend(5000, 'Shopping', '2026-10-02');
      const b = await budget('Shopping', 50000);
      const detail = (await api.get(`/api/budgets/${b.id}`, alex)).json();
      expect(detail.history).toHaveLength(6);
      expect(detail.history[0]).toEqual({
        from: '2026-09-01',
        to: '2026-09-30',
        spent: 60000,
        limit: 50000,
        overBudget: true,
      });
      expect(detail.history[1]).toMatchObject({
        from: '2026-08-01',
        spent: 10000,
        overBudget: false,
      });
      expect(detail.history[5]).toMatchObject({ from: '2026-04-01', spent: 0 });
    });
  });

  describe('tenant isolation', () => {
    it('Bea cannot see, change or create budgets against Alex’s data', async () => {
      await spend(10000, 'Shopping', '2026-10-02');
      const b = await budget('Shopping', 50000);
      const bea = await api.signUp('bea@example.com', 'Bea');
      expect((await list(bea)).budgets).toEqual([]);
      expect((await api.get(`/api/budgets/${b.id}`, bea)).statusCode).toBe(404);
      expect((await api.patch(`/api/budgets/${b.id}`, bea, { amount: 1 })).statusCode).toBe(404);
      expect((await api.delete(`/api/budgets/${b.id}`, bea)).statusCode).toBe(404);
      expect(
        (await api.post('/api/budgets', bea, { categoryId: cat.Shopping, amount: 1000 }))
          .statusCode,
      ).toBe(400);
      expect((await list()).budgets).toHaveLength(1);
    });

    it('requires a session', async () => {
      expect((await api.get('/api/budgets', null)).statusCode).toBe(401);
    });
  });
});
