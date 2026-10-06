import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApiClient, type ApiClient, type Session } from '../../../test/api-client';
import { createTestApp, resetDb } from '../../../test/helpers';

type Ctx = Awaited<ReturnType<typeof createTestApp>>;
const clock = new Date('2026-10-15T12:00:00Z');

interface Result {
  understood: string[];
  transactionFilter: Record<string, string>;
  transactions: { total: number; items: { description: string; categoryName: string | null }[] };
  accounts: { name: string }[];
  categories: { name: string; parentName: string | null }[];
  goals: { name: string }[];
  recurring: { description: string }[];
}

describe('search API', () => {
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
        name: 'Northwind Checking',
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
    const add = (description: string, amount: number, date: string, category: string) =>
      api.post('/api/transactions', alex, {
        type: 'expense',
        accountId: checking,
        categoryId: cat[category],
        amount,
        description,
        date,
      });
    await add('Starbucks', 450, '2026-10-10', 'Coffee');
    await add('Whole Foods', 8200, '2026-09-20', 'Groceries');
    await add('Safeway', 3100, '2026-09-05', 'Groceries');
    await add('Lunch', 1250, '2026-10-12', 'Restaurants');
    await add('Rent', 185000, '2026-09-01', 'Rent');
  });

  const search = async (q: string, s: Session | null = alex) => {
    const res = await api.get(`/api/search?q=${encodeURIComponent(q)}`, s);
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as Result;
  };

  it('finds transactions by text, case-insensitively', async () => {
    const r = await search('starbu');
    expect(r.transactions.items.map((t) => t.description)).toEqual(['Starbucks']);
    expect(r.understood).toEqual([]);
  });

  it('finds accounts, categories, goals and recurring payments too', async () => {
    await api.post('/api/goals', alex, { name: 'Rent deposit', targetAmount: 100000 });
    await api.post('/api/recurring', alex, {
      type: 'expense',
      accountId: checking,
      amount: 185000,
      description: 'Rent',
      frequency: 'monthly',
      nextOccurrence: '2026-11-01',
    });
    const r = await search('rent');
    expect(r.categories.map((c) => c.name)).toContain('Rent');
    expect(r.goals.map((g) => g.name)).toEqual(['Rent deposit']);
    expect(r.recurring.map((x) => x.description)).toEqual(['Rent']);
    expect((await search('northwind')).accounts.map((a) => a.name)).toEqual(['Northwind Checking']);
  });

  it('understands "expenses over $50 last month" and says so', async () => {
    const r = await search('expenses over $50 last month');
    expect(r.understood).toEqual(['expenses', 'over $50', 'last month']);
    expect(r.transactions.items.map((t) => t.description).sort()).toEqual(['Rent', 'Whole Foods']);
    expect(r.transactionFilter).toMatchObject({
      type: 'expense',
      amountMin: '5001',
      dateFrom: '2026-09-01',
      dateTo: '2026-09-30',
    });
  });

  it('understands categories and returns their names', async () => {
    const r = await search('groceries this month');
    expect(r.transactions.total).toBe(0);
    const all = await search('groceries');
    expect(all.transactions.items.map((t) => t.categoryName)).toEqual(['Groceries', 'Groceries']);
    expect(all.understood).toEqual(['in Groceries']);
  });

  it('understands an exact amount', async () => {
    const r = await search('$12.50');
    expect(r.transactions.items.map((t) => t.description)).toEqual(['Lunch']);
  });

  it('caps what it lists but reports the real total', async () => {
    for (let i = 0; i < 8; i++) {
      await api.post('/api/transactions', alex, {
        type: 'expense',
        accountId: checking,
        amount: 100 + i,
        description: `Snack ${i}`,
        date: '2026-10-01',
      });
    }
    const r = await search('snack');
    expect(r.transactions.items).toHaveLength(6);
    expect(r.transactions.total).toBe(8);
  });

  it('validates input and requires sign-in', async () => {
    expect((await api.get('/api/search?q=', alex)).statusCode).toBe(400);
    expect((await api.get('/api/search', alex)).statusCode).toBe(400);
    expect((await api.get('/api/search?q=x', null)).statusCode).toBe(401);
  });

  it("never returns someone else's data", async () => {
    const bea = await api.signUp('bea@example.com', 'Bea');
    const r = await search('starbucks', bea);
    expect(r.transactions.total).toBe(0);
    expect((await search('northwind', bea)).accounts).toEqual([]);
  });

  it('treats SQL-ish and regex-ish input as plain text', async () => {
    const r = await search('\'; DROP TABLE "Transaction"; -- (.*)');
    expect(r.transactions.total).toBe(0);
    expect((await search('starbucks')).transactions.total).toBe(1);
  });
});
