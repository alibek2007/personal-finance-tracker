import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApiClient, type ApiClient, type Session } from '../../../test/api-client';
import { createTestApp, resetDb } from '../../../test/helpers';

type Ctx = Awaited<ReturnType<typeof createTestApp>>;
const clock = new Date('2026-10-15T12:00:00Z');

describe('calendar API', () => {
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
        initialBalance: 1_000_000,
      })
    ).json().id;
    const cats = (await api.get('/api/categories', alex)).json().categories as {
      id: string;
      name: string;
    }[];
    cat = Object.fromEntries(cats.map((c) => [c.name, c.id]));
  });

  const tx = (body: Record<string, unknown>) =>
    api.post('/api/transactions', alex, {
      type: 'expense',
      accountId: checking,
      amount: 1000,
      description: 'Thing',
      date: '2026-10-05',
      ...body,
    });
  const month = async (from = '2026-10-01', to = '2026-10-31', s: Session | null = alex) => {
    const res = await api.get(`/api/calendar?from=${from}&to=${to}`, s);
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as {
      today: string;
      currency: string;
      days: {
        date: string;
        income: number;
        expense: number;
        transactions: { description: string }[];
        upcoming: { description: string; amount: number }[];
        goalDeadlines: { name: string; remaining: number }[];
      }[];
    };
  };

  it('is empty for a new user, and only lists days that have something', async () => {
    const cal = await month();
    expect(cal).toMatchObject({ today: '2026-10-15', currency: 'USD', days: [] });
  });

  it('totals what moved each day, with refunds reducing spending', async () => {
    await tx({ amount: 2500, description: 'Lunch' });
    await tx({ amount: 1500, description: 'Coffee' });
    await tx({
      type: 'income',
      amount: 400000,
      categoryId: cat.Salary,
      description: 'Pay',
      date: '2026-10-05',
    });
    await tx({
      type: 'income',
      amount: 500,
      isRefund: true,
      categoryId: cat.Food,
      description: 'Refund',
      date: '2026-10-05',
    });
    await tx({ amount: 700, description: 'Bus', date: '2026-10-09' });
    const cal = await month();
    expect(cal.days.map((d) => d.date)).toEqual(['2026-10-05', '2026-10-09']);
    expect(cal.days[0]).toMatchObject({ income: 400000, expense: 3500 });
    expect(cal.days[0]!.transactions.map((t) => t.description)).toEqual([
      'Lunch',
      'Coffee',
      'Pay',
      'Refund',
    ]);
    expect(cal.days[1]).toMatchObject({ income: 0, expense: 700 });
  });

  it('keeps other currencies out of the daily totals but lists them', async () => {
    const eur = (
      await api.post('/api/accounts', alex, { name: 'Euro', type: 'bank', currency: 'EUR' })
    ).json().id;
    await tx({ accountId: eur, amount: 9000, description: 'Berlin' });
    const cal = await month();
    expect(cal.days[0]).toMatchObject({ expense: 0 });
    expect(cal.days[0]!.transactions).toHaveLength(1);
  });

  it('shows upcoming payments from today on, never in the past', async () => {
    await api.post('/api/recurring', alex, {
      type: 'expense',
      accountId: checking,
      amount: 1599,
      description: 'Netflix',
      frequency: 'monthly',
      nextOccurrence: '2026-10-20',
    });
    const cal = await month();
    expect(cal.days).toHaveLength(1);
    expect(cal.days[0]).toMatchObject({
      date: '2026-10-20',
      upcoming: [{ description: 'Netflix', amount: 1599 }],
    });
    const nov = await month('2026-11-01', '2026-11-30');
    expect(nov.days[0]!.date).toBe('2026-11-20');
    // A past range shows no projected payments.
    expect((await month('2026-09-01', '2026-09-30')).days).toEqual([]);
  });

  it('records a payment due today as a transaction, not an upcoming item', async () => {
    await api.post('/api/recurring', alex, {
      type: 'expense',
      accountId: checking,
      amount: 999,
      description: 'Spotify',
      frequency: 'monthly',
      nextOccurrence: '2026-10-15',
    });
    const day = (await month()).days.find((d) => d.date === '2026-10-15')!;
    expect(day.transactions.map((t) => t.description)).toEqual(['Spotify']);
    expect(day.upcoming).toEqual([]);
  });

  it('marks goal deadlines with what is still missing, and skips archived goals', async () => {
    const g = (
      await api.post('/api/goals', alex, {
        name: 'Laptop',
        targetAmount: 100000,
        deadline: '2026-10-28',
        startingAmount: 40000,
      })
    ).json();
    const old = (
      await api.post('/api/goals', alex, {
        name: 'Old',
        targetAmount: 5000,
        deadline: '2026-10-29',
      })
    ).json();
    await api.patch(`/api/goals/${old.id}`, alex, { isArchived: true });
    const cal = await month();
    expect(cal.days).toHaveLength(1);
    expect(cal.days[0]).toMatchObject({
      date: '2026-10-28',
      goalDeadlines: [{ name: 'Laptop', remaining: 60000 }],
    });
    expect(g.id).toBeTruthy();
  });

  it('validates the range and requires sign-in', async () => {
    expect((await api.get('/api/calendar?from=2026-10-31&to=2026-10-01', alex)).statusCode).toBe(
      400,
    );
    expect((await api.get('/api/calendar?from=2026-01-01&to=2026-12-31', alex)).statusCode).toBe(
      400,
    );
    expect((await api.get('/api/calendar?from=2026-10-01&to=2026-10-31', null)).statusCode).toBe(
      401,
    );
  });

  it("never shows another user's days", async () => {
    await tx({ description: 'Secret' });
    const bea = await api.signUp('bea@example.com', 'Bea');
    expect((await month('2026-10-01', '2026-10-31', bea)).days).toEqual([]);
  });
});
