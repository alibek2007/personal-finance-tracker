import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { summarizeBalances } from '@pfm/finance';
import { createDb, type Db } from '../../lib/db';
import { createAccountsService } from '../accounts/accounts.service';
import { testEnv } from '../../../test/helpers';
import { buildDemoTransactions } from './demo-data';
import { DEMO_EMAIL, seedDemo } from './seed-demo';

const TODAY = new Date('2026-10-05T12:00:00Z');

describe('demo data generator', () => {
  it('is deterministic', () => {
    expect(buildDemoTransactions(TODAY)).toEqual(buildDemoTransactions(TODAY));
    expect(buildDemoTransactions(TODAY, 1)).not.toEqual(buildDemoTransactions(TODAY, 2));
  });

  it('never invents the future and spans about four months', () => {
    const txs = buildDemoTransactions(TODAY);
    expect(txs.every((t) => t.date <= '2026-10-05')).toBe(true);
    expect(txs[0]!.date >= '2026-07-01').toBe(true);
    expect(txs.length).toBeGreaterThan(100);
  });

  it('subscriptions total about $47 a month', () => {
    const subs = buildDemoTransactions(TODAY).filter(
      (t) => t.category === 'Subscriptions' && t.date.startsWith('2026-09'),
    );
    expect(subs.reduce((sum, t) => sum + t.amount, 0)).toBe(4697);
  });
});

describe('seeded demo user', () => {
  let db: Db;
  beforeAll(() => {
    db = createDb(testEnv().DATABASE_URL);
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it('produces consistent, believable books', async () => {
    const result = await seedDemo(db, TODAY);
    const accounts = createAccountsService(db);

    // The cached balances equal opening balance + every transaction.
    expect(await accounts.reconcile(result.userId)).toEqual([]);

    const byName = Object.fromEntries(result.accounts.map((a) => [a.name, a.balance]));
    expect(byName['Credit Card']).toBeLessThanOrEqual(0); // debt, never positive wealth
    expect(byName['Checking']).toBeGreaterThan(0);
    expect(byName['Savings']).toBeGreaterThan(700_000); // monthly transfers + interest
    expect(result.lowestCheckingBalance).toBeGreaterThan(0); // never overdrawn in the demo

    const listed = await accounts.list(result.userId);
    const [usd] = summarizeBalances(
      listed.accounts.map((a) => ({ currency: a.currency, balance: a.currentBalance })),
    );
    expect(usd!.netWorth).toBe(usd!.assets - usd!.debts);
    expect(usd!.netWorth).toBeGreaterThan(0);
  });

  it('includes believable monthly budgets that reflect the seeded spending', async () => {
    const result = await seedDemo(db, TODAY);
    const budgets = await db.budget.findMany({
      where: { userId: result.userId },
      include: { category: true },
    });
    expect(budgets.map((b) => b.category.name).sort()).toEqual([
      'Entertainment',
      'Food',
      'Shopping',
      'Transport',
    ]);
    expect(result.budgets).toBe(4);
    expect(budgets.every((b) => b.period === 'monthly' && b.alertThreshold === 80)).toBe(true);
  });

  it('includes savings goals whose totals match their contributions', async () => {
    const result = await seedDemo(db, TODAY);
    const goals = await db.savingsGoal.findMany({
      where: { userId: result.userId },
      orderBy: { name: 'asc' },
    });
    expect(goals.map((g) => [g.name, Number(g.currentAmount)])).toEqual([
      ['Emergency Fund', 320_000],
      ['Laptop', 120_000],
      ['Vacation', 85_000],
    ]);
    const sums = await db.goalContribution.groupBy({ by: ['goalId'], _sum: { amount: true } });
    expect(sums).toHaveLength(3);
    expect(result.goals).toBe(3);
  });

  it('sets up recurring payments whose history is linked and whose next date is still to come', async () => {
    const result = await seedDemo(db, TODAY);
    const rules = await db.recurringTransaction.findMany({
      where: { userId: result.userId },
      orderBy: { description: 'asc' },
    });
    expect(rules.map((r) => r.description)).toEqual([
      'Dropbox',
      'Netflix',
      'Rent',
      'Salary',
      'Spotify',
      'iCloud+',
    ]);
    expect(result.recurring).toBe(6);
    expect(rules.every((r) => r.nextOccurrence.toISOString().slice(0, 10) > '2026-10-05')).toBe(
      true,
    );
    const linked = await db.transaction.count({
      where: { userId: result.userId, isRecurring: true, recurringTransactionId: { not: null } },
    });
    expect(linked).toBeGreaterThan(20);
  });

  it('is repeatable: seeding twice leaves one user with the same data', async () => {
    const first = await seedDemo(db, TODAY);
    const second = await seedDemo(db, TODAY);
    expect(await db.user.count({ where: { email: DEMO_EMAIL } })).toBe(1);
    expect(second.transactions).toBe(first.transactions);
    expect(second.accounts).toEqual(first.accounts);
    expect(await db.transaction.count({ where: { userId: second.userId } })).toBe(
      second.transactions,
    );
  });
});
