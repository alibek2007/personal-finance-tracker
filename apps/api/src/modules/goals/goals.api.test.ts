import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApiClient, type ApiClient, type Session } from '../../../test/api-client';
import { createTestApp, resetDb } from '../../../test/helpers';

type Ctx = Awaited<ReturnType<typeof createTestApp>>;
let clock = new Date('2026-10-15T12:00:00Z');

describe('goals API', () => {
  let ctx: Ctx;
  let api: ApiClient;
  let alex: Session;

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
  });

  const goal = async (over: Record<string, unknown> = {}) => {
    const res = await api.post('/api/goals', alex, {
      name: 'Laptop',
      targetAmount: 200000,
      ...over,
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json();
  };
  const contribute = (id: string, body: Record<string, unknown>, s: Session = alex) =>
    api.post(`/api/goals/${id}/contributions`, s, body);
  const reconciled = async () =>
    expect((await api.post('/api/goals/reconcile', alex)).json().drift).toEqual([]);

  describe('creating', () => {
    it('starts a goal with an optional starting amount and says what to save each month', async () => {
      const g = await goal({ deadline: '2027-03-31', startingAmount: 50000 });
      expect(g).toMatchObject({
        name: 'Laptop',
        targetAmount: 200000,
        currentAmount: 50000,
        currency: 'USD',
        progressBp: 2500,
        remaining: 150000,
        reached: false,
        monthsLeft: 6,
        requiredMonthly: 25000,
        // Created today with $500 already put aside: ahead of a plan that expects $0 on day one.
        status: 'ahead',
        headline: '$250/month to reach your goal by March 2027',
      });
      const detail = (await api.get(`/api/goals/${g.id}`, alex)).json();
      expect(detail.contributions).toHaveLength(1);
      expect(detail.contributions[0]).toMatchObject({
        amount: 50000,
        note: 'Starting amount',
        date: '2026-10-15',
      });
      await reconciled();
    });

    it('a goal without a deadline shows progress but no monthly figure', async () => {
      const g = await goal();
      expect(g).toMatchObject({
        currentAmount: 0,
        status: 'no_deadline',
        requiredMonthly: null,
        deadline: null,
      });
      expect(g.detail).toBe('Add a deadline to see how much to save each month.');
    });

    it('validates in plain language', async () => {
      expect(
        (await api.post('/api/goals', alex, { name: '', targetAmount: 1000 })).statusCode,
      ).toBe(400);
      expect((await api.post('/api/goals', alex, { name: 'X', targetAmount: 0 })).statusCode).toBe(
        400,
      );
      expect(
        (await api.post('/api/goals', alex, { name: 'X', targetAmount: 12.5 })).statusCode,
      ).toBe(400);
      expect(
        (await api.post('/api/goals', alex, { name: 'X', targetAmount: 1000, startingAmount: -5 }))
          .statusCode,
      ).toBe(400);
      const past = await api.post('/api/goals', alex, {
        name: 'X',
        targetAmount: 1000,
        deadline: '2026-10-14',
      });
      expect(past.statusCode).toBe(400);
      expect(past.json().error.details.deadline[0]).toMatch(/today or later/);
      expect(
        (
          await api.post('/api/goals', alex, {
            name: 'X',
            targetAmount: 1000,
            deadline: '2026-02-30',
          })
        ).statusCode,
      ).toBe(400);
    });

    it('goal names are unique per user, ignoring case', async () => {
      await goal();
      expect(
        (await api.post('/api/goals', alex, { name: 'laptop', targetAmount: 1000 })).statusCode,
      ).toBe(409);
      const bea = await api.signUp('bea@example.com', 'Bea');
      expect(
        (await api.post('/api/goals', bea, { name: 'Laptop', targetAmount: 1000 })).statusCode,
      ).toBe(201);
    });
  });

  describe('contributions', () => {
    it('deposits and withdrawals move the total exactly', async () => {
      const g = await goal();
      expect((await contribute(g.id, { amount: 30000 })).json().currentAmount).toBe(30000);
      expect(
        (await contribute(g.id, { amount: 12550, note: 'Birthday money' })).json().currentAmount,
      ).toBe(42550);
      expect((await contribute(g.id, { amount: -10000 })).json().currentAmount).toBe(32550);
      await reconciled();
    });

    it('cannot take out more than is saved', async () => {
      const g = await goal({ startingAmount: 5000 });
      const res = await contribute(g.id, { amount: -5001 });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.details.amount[0]).toBe(
        "You can't take out more than is saved ($50.00).",
      );
      expect((await contribute(g.id, { amount: -5000 })).json().currentAmount).toBe(0);
    });

    it('rejects zero, fractional amounts and future dates; allows back-dating', async () => {
      const g = await goal();
      expect((await contribute(g.id, { amount: 0 })).statusCode).toBe(400);
      expect((await contribute(g.id, { amount: 10.5 })).statusCode).toBe(400);
      const future = await contribute(g.id, { amount: 1000, date: '2026-10-16' });
      expect(future.statusCode).toBe(400);
      expect(future.json().error.details.date).toBeTruthy();
      expect((await contribute(g.id, { amount: 1000, date: '2026-06-01' })).statusCode).toBe(201);
    });

    it('"today" for a contribution follows the user’s timezone', async () => {
      await api.patch('/api/me', alex, { timezone: 'Asia/Almaty' });
      clock = new Date('2026-10-14T20:30:00Z'); // already the 15th in Almaty
      const g = await goal();
      expect((await contribute(g.id, { amount: 1000, date: '2026-10-15' })).statusCode).toBe(201);
    });

    it('removing a contribution reverses it, unless later withdrawals depend on it', async () => {
      const g = await goal();
      await contribute(g.id, { amount: 20000, date: '2026-09-01' });
      await contribute(g.id, { amount: -15000, date: '2026-10-01' });
      const detail = (await api.get(`/api/goals/${g.id}`, alex)).json();
      const [withdrawal, deposit] = detail.contributions;
      const blocked = await api.delete(`/api/goals/${g.id}/contributions/${deposit.id}`, alex);
      expect(blocked.statusCode).toBe(400);
      expect(blocked.json().error.code).toBe('would_go_negative');
      const undone = await api.delete(`/api/goals/${g.id}/contributions/${withdrawal.id}`, alex);
      expect(undone.json().currentAmount).toBe(20000);
      expect(
        (await api.delete(`/api/goals/${g.id}/contributions/${deposit.id}`, alex)).json()
          .currentAmount,
      ).toBe(0);
      await reconciled();
    });

    it('lists contributions newest first', async () => {
      const g = await goal();
      await contribute(g.id, { amount: 1000, date: '2026-08-01' });
      await contribute(g.id, { amount: 2000, date: '2026-10-01' });
      await contribute(g.id, { amount: 3000, date: '2026-09-01' });
      const dates = (await api.get(`/api/goals/${g.id}`, alex))
        .json()
        .contributions.map((c: { date: string }) => c.date);
      expect(dates).toEqual(['2026-10-01', '2026-09-01', '2026-08-01']);
    });

    it('stays exact under concurrent deposits', async () => {
      const g = await goal();
      const amounts = Array.from({ length: 15 }, (_, i) => 100 + i);
      const results = await Promise.all(amounts.map((amount) => contribute(g.id, { amount })));
      expect(results.every((r) => r.statusCode === 201)).toBe(true);
      expect((await api.get(`/api/goals/${g.id}`, alex)).json().currentAmount).toBe(
        amounts.reduce((a, b) => a + b, 0),
      );
      await reconciled();
    });

    it('an archived goal cannot receive contributions until restored', async () => {
      const g = await goal();
      await api.patch(`/api/goals/${g.id}`, alex, { isArchived: true });
      const blocked = await contribute(g.id, { amount: 1000 });
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json().error.code).toBe('goal_archived');
      await api.patch(`/api/goals/${g.id}`, alex, { isArchived: false });
      expect((await contribute(g.id, { amount: 1000 })).statusCode).toBe(201);
    });
  });

  describe('status over time', () => {
    it('reaching the target says so, and over-funding is recorded as surplus', async () => {
      const g = await goal({ targetAmount: 100000, deadline: '2027-01-31' });
      const done = (await contribute(g.id, { amount: 112300 })).json();
      expect(done).toMatchObject({
        status: 'reached',
        reached: true,
        headline: 'Goal reached',
        detail: "You're $123 over your target.",
        surplus: 12300,
        requiredMonthly: null,
      });
    });

    it('measures ahead/behind against a straight line from when saving started', async () => {
      // saving began 2026-04-15 (back-dated contribution); deadline 2027-04-15 => half a year of a year elapsed
      const g = await goal({ targetAmount: 120000, deadline: '2027-04-15' });
      await contribute(g.id, { amount: 10000, date: '2026-04-15' });
      const behind = (await api.get(`/api/goals/${g.id}`, alex)).json();
      expect(behind.startedOn).toBe('2026-04-15');
      expect(behind.status).toBe('behind');
      expect(behind.scheduleDelta).toBeLessThan(0);
      expect(behind.detail).toMatch(/behind schedule/);
      await contribute(g.id, { amount: 80000, date: '2026-10-01' });
      const ahead = (await api.get(`/api/goals/${g.id}`, alex)).json();
      expect(ahead.status).toBe('ahead');
      expect(ahead.detail).toMatch(/ahead of schedule/);
    });

    it('becomes overdue after the deadline and stops asking for a monthly amount', async () => {
      const g = await goal({ deadline: '2026-11-01', startingAmount: 10000 });
      clock = new Date('2026-11-02T12:00:00Z');
      const late = (await api.get(`/api/goals/${g.id}`, alex)).json();
      expect(late).toMatchObject({ status: 'overdue', requiredMonthly: null });
      expect(late.detail).toBe('The deadline (November) has passed. Move it, or keep going.');
    });

    it('the deadline day itself is not overdue', async () => {
      const g = await goal({ deadline: '2026-10-15' });
      expect((await api.get(`/api/goals/${g.id}`, alex)).json().status).not.toBe('overdue');
    });
  });

  describe('editing', () => {
    it('changing the target or deadline recalculates immediately', async () => {
      const g = await goal({ deadline: '2027-03-31', startingAmount: 50000 });
      const bigger = (await api.patch(`/api/goals/${g.id}`, alex, { targetAmount: 350000 })).json();
      expect(bigger).toMatchObject({
        targetAmount: 350000,
        requiredMonthly: 50000,
        progressBp: 1429,
      });
      const moved = (
        await api.patch(`/api/goals/${g.id}`, alex, { deadline: '2028-03-31' })
      ).json();
      expect(moved.monthsLeft).toBe(18);
      const cleared = (await api.patch(`/api/goals/${g.id}`, alex, { deadline: null })).json();
      expect(cleared).toMatchObject({ deadline: null, status: 'no_deadline' });
    });

    it('does not accept a past deadline when changing it, but leaves an old one alone', async () => {
      const g = await goal({ deadline: '2026-11-01' });
      expect(
        (await api.patch(`/api/goals/${g.id}`, alex, { deadline: '2026-10-01' })).statusCode,
      ).toBe(400);
      clock = new Date('2026-12-01T12:00:00Z');
      expect((await api.patch(`/api/goals/${g.id}`, alex, { name: 'Laptop 2' })).statusCode).toBe(
        200,
      );
    });

    it('archived goals are hidden by default and excluded from the summary', async () => {
      const a = await goal({ name: 'A', targetAmount: 100000, startingAmount: 40000 });
      await goal({ name: 'B', targetAmount: 50000, startingAmount: 10000 });
      await api.patch(`/api/goals/${a.id}`, alex, { isArchived: true });
      const active = (await api.get('/api/goals', alex)).json();
      expect(active.goals.map((x: { name: string }) => x.name)).toEqual(['B']);
      expect(active.summary).toEqual({ currency: 'USD', saved: 10000, target: 50000, count: 1 });
      const all = (await api.get('/api/goals?includeArchived=true', alex)).json();
      expect(all.goals.map((x: { name: string }) => x.name)).toEqual(['B', 'A']);
    });

    it('deleting a goal removes its contributions too', async () => {
      const g = await goal({ startingAmount: 1000 });
      expect((await api.delete(`/api/goals/${g.id}`, alex)).statusCode).toBe(200);
      expect(await ctx.db.goalContribution.count()).toBe(0);
      expect((await api.get(`/api/goals/${g.id}`, alex)).statusCode).toBe(404);
    });

    it('no summary when there are no goals', async () => {
      expect((await api.get('/api/goals', alex)).json()).toEqual({ goals: [], summary: null });
    });
  });

  describe('integrity', () => {
    it('reconcile really detects a corrupted total', async () => {
      const g = await goal({ startingAmount: 5000 });
      await ctx.db.savingsGoal.update({ where: { id: g.id }, data: { currentAmount: 9999n } });
      const drift = (await api.post('/api/goals/reconcile', alex)).json().drift;
      expect(drift).toEqual([{ goalId: g.id, name: 'Laptop', stored: 9999, expected: 5000 }]);
    });
  });

  describe('tenant isolation', () => {
    it('Bea cannot see or change Alex’s goals', async () => {
      const g = await goal({ startingAmount: 5000 });
      const detail = (await api.get(`/api/goals/${g.id}`, alex)).json();
      const bea = await api.signUp('bea@example.com', 'Bea');
      expect((await api.get('/api/goals', bea)).json().goals).toEqual([]);
      expect((await api.get(`/api/goals/${g.id}`, bea)).statusCode).toBe(404);
      expect((await api.patch(`/api/goals/${g.id}`, bea, { name: 'Hacked' })).statusCode).toBe(404);
      expect((await api.delete(`/api/goals/${g.id}`, bea)).statusCode).toBe(404);
      expect((await contribute(g.id, { amount: 100 }, bea)).statusCode).toBe(404);
      expect(
        (await api.delete(`/api/goals/${g.id}/contributions/${detail.contributions[0].id}`, bea))
          .statusCode,
      ).toBe(404);
      expect((await api.get(`/api/goals/${g.id}`, alex)).json().currentAmount).toBe(5000);
    });

    it('requires a session', async () => {
      expect((await api.get('/api/goals', null)).statusCode).toBe(401);
    });
  });
});
