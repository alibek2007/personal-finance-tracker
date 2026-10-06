import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApiClient, type ApiClient, type Session } from '../../../test/api-client';
import { createTestApp, resetDb } from '../../../test/helpers';

type Ctx = Awaited<ReturnType<typeof createTestApp>>;
let clock = new Date('2026-10-15T12:00:00Z');

interface N {
  id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  link: string | null;
}

describe('notifications API', () => {
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

  const feed = async (s: Session = alex, query = '') =>
    (await api.get(`/api/notifications${query}`, s)).json() as {
      items: N[];
      unreadCount: number;
    };
  const spend = async (amount: number, category: string, date = '2026-10-10') => {
    const res = await api.post('/api/transactions', alex, {
      type: 'expense',
      accountId: checking,
      amount,
      categoryId: cat[category],
      description: category,
      date,
    });
    expect(res.statusCode, res.body).toBe(201);
  };

  it('starts empty, with nothing unread', async () => {
    expect(await feed()).toEqual({ items: [], unreadCount: 0 });
    expect((await api.get('/api/notifications/unread-count', alex)).json()).toEqual({
      unreadCount: 0,
    });
  });

  it('requires a signed-in user', async () => {
    expect((await api.get('/api/notifications', null)).statusCode).toBe(401);
  });

  describe('budgets', () => {
    it('warns once when spending reaches the alert threshold', async () => {
      await api.post('/api/budgets', alex, { categoryId: cat.Food, amount: 50000 });
      await spend(30000, 'Food');
      expect((await feed()).items).toHaveLength(0);
      await spend(11000, 'Food'); // 82%
      const first = await feed();
      expect(first.items).toHaveLength(1);
      expect(first.items[0]).toMatchObject({
        type: 'budget_threshold',
        title: 'Food budget at 82%',
        isRead: false,
        link: '/budgets',
        message: '$90.00 left until Oct 31.',
      });
      expect(first.unreadCount).toBe(1);
      // Asking again must not repeat it.
      expect((await feed()).items).toHaveLength(1);
    });

    it('says when a budget is exceeded, as a separate notice', async () => {
      await api.post('/api/budgets', alex, { categoryId: cat.Food, amount: 50000 });
      await spend(42000, 'Food');
      await feed();
      await spend(12000, 'Food');
      const items = (await feed()).items;
      expect(items.map((n) => n.type).sort()).toEqual(['budget_exceeded', 'budget_threshold']);
      const over = items.find((n) => n.type === 'budget_exceeded')!;
      expect(over.title).toBe('Food budget exceeded');
      expect(over.message).toContain('$40.00 over');
    });

    it('notifies again in a new budget period', async () => {
      await api.post('/api/budgets', alex, { categoryId: cat.Food, amount: 50000 });
      await spend(45000, 'Food');
      expect((await feed()).items).toHaveLength(1);
      clock = new Date('2026-11-12T12:00:00Z');
      await spend(45000, 'Food', '2026-11-10');
      expect((await feed()).items).toHaveLength(2);
    });
  });

  describe('bills', () => {
    const bill = (nextOccurrence: string, over: Record<string, unknown> = {}) =>
      api.post('/api/recurring', alex, {
        type: 'expense',
        accountId: checking,
        amount: 1599,
        description: 'Netflix',
        frequency: 'monthly',
        nextOccurrence,
        ...over,
      });

    it('announces a bill a few days before it is due, once', async () => {
      await bill('2026-10-17');
      const items = (await feed()).items;
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        type: 'bill_due',
        title: 'Netflix is due on Oct 17',
        link: '/recurring',
      });
      expect(items[0]!.message).toBe('$15.99 will be recorded on Oct 17.');
      expect((await feed()).items).toHaveLength(1);
    });

    it('says "tomorrow" and ignores bills further away, paused bills and income', async () => {
      await bill('2026-10-16');
      await bill('2026-10-25', { description: 'Far' });
      const paused = (await bill('2026-10-17', { description: 'Paused' })).json();
      await api.patch(`/api/recurring/${paused.id}`, alex, { isActive: false });
      await bill('2026-10-16', { description: 'Pay', type: 'income', categoryId: cat.Salary });
      const items = (await feed()).items;
      expect(items.map((n) => n.title)).toEqual(['Netflix is due tomorrow']);
    });

    it('does not announce a payment already recorded today', async () => {
      await bill('2026-10-15');
      expect((await feed()).items).toEqual([]);
    });
  });

  describe('goals', () => {
    it('celebrates a reached goal once', async () => {
      const g = (
        await api.post('/api/goals', alex, { name: 'Laptop', targetAmount: 100000 })
      ).json();
      expect((await feed()).items).toHaveLength(0);
      await api.post(`/api/goals/${g.id}/contributions`, alex, {
        amount: 100000,
        date: '2026-10-15',
      });
      const items = (await feed()).items;
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ type: 'goal_progress', title: 'Laptop reached' });
      expect((await feed()).items).toHaveLength(1);
    });
  });

  describe('reading', () => {
    beforeEach(async () => {
      await api.post('/api/budgets', alex, { categoryId: cat.Food, amount: 50000 });
      await spend(45000, 'Food');
      await api.post('/api/recurring', alex, {
        type: 'expense',
        accountId: checking,
        amount: 999,
        description: 'Spotify',
        frequency: 'monthly',
        nextOccurrence: '2026-10-16',
      });
    });

    it('marks one read and unread, and filters to unread', async () => {
      const { items } = await feed();
      expect(items).toHaveLength(2);
      const one = items[0]!;
      const read = await api.patch(`/api/notifications/${one.id}`, alex, { isRead: true });
      expect(read.json().isRead).toBe(true);
      expect((await feed()).unreadCount).toBe(1);
      expect((await feed(alex, '?unread=true')).items.map((n) => n.id)).not.toContain(one.id);
      await api.patch(`/api/notifications/${one.id}`, alex, { isRead: false });
      expect((await feed()).unreadCount).toBe(2);
    });

    it('marks everything read, and reading never brings notices back', async () => {
      const res = await api.post('/api/notifications/read-all', alex);
      expect(res.json()).toEqual({ unreadCount: 0 });
      const after = await feed();
      expect(after.items).toHaveLength(2);
      expect(after.items.every((n) => n.isRead)).toBe(true);
      expect(after.unreadCount).toBe(0);
    });

    it('lists newest first and honours the limit', async () => {
      expect((await feed(alex, '?limit=1')).items).toHaveLength(1);
      expect((await api.get('/api/notifications?limit=500', alex)).statusCode).toBe(400);
    });
  });

  describe('privacy', () => {
    it("never shows or changes someone else's notifications", async () => {
      await api.post('/api/budgets', alex, { categoryId: cat.Food, amount: 50000 });
      await spend(45000, 'Food');
      const mine = (await feed()).items[0]!;
      const bea = await api.signUp('bea@example.com', 'Bea');
      expect(await feed(bea)).toEqual({ items: [], unreadCount: 0 });
      expect(
        (await api.patch(`/api/notifications/${mine.id}`, bea, { isRead: true })).statusCode,
      ).toBe(404);
      await api.post('/api/notifications/read-all', bea);
      expect((await feed()).unreadCount).toBe(1);
    });
  });
});
