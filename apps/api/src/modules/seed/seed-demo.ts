import { addMonths, balanceHistory, nextAfter, todayInZone } from '@pfm/finance';
import type { Db } from '../../lib/db';
import { hashPassword } from '../../lib/password';
import { createAccountsService, ledgerTxsForAccount } from '../accounts/accounts.service';
import { createBudgetsService } from '../budgets/budgets.service';
import { createGoalsService } from '../goals/goals.service';
import { seedDefaultCategories } from '../categories/categories.service';
import { createTransactionsService } from '../transactions/transactions.service';
import { fromIsoDate, fromMinor, toMinor } from '../../lib/convert';
import { buildDemoTransactions, DEMO_ACCOUNTS, type AccountKey } from './demo-data';

export const DEMO_EMAIL = 'alex@example.com';
export const DEMO_PASSWORD = 'demo-password-123';

/** Payments Alex has set up as recurring: their past occurrences in the demo ledger are linked to the rule. */
const DEMO_RECURRING: { description: string; account: AccountKey; type: 'income' | 'expense' }[] = [
  { description: 'Salary', account: 'checking', type: 'income' },
  { description: 'Rent', account: 'checking', type: 'expense' },
  { description: 'iCloud+', account: 'card', type: 'expense' },
  { description: 'Dropbox', account: 'card', type: 'expense' },
  { description: 'Netflix', account: 'card', type: 'expense' },
  { description: 'Spotify', account: 'card', type: 'expense' },
];

export interface DemoResult {
  userId: string;
  transactions: number;
  recurring: number;
  budgets: number;
  goals: number;
  accounts: { name: string; balance: number }[];
  lowestCheckingBalance: number;
}

/**
 * Creates (or recreates) the demo user "Alex" through the same services the API uses,
 * so seeded data obeys every ledger rule. Ends by reconciling every balance.
 */
export async function seedDemo(db: Db, today: Date = new Date()): Promise<DemoResult> {
  await db.user.deleteMany({ where: { email: DEMO_EMAIL } }); // cascades to all of their data
  const user = await db.user.create({
    data: {
      email: DEMO_EMAIL,
      name: 'Alex Morgan',
      passwordHash: await hashPassword(DEMO_PASSWORD),
      emailVerifiedAt: new Date(),
      currency: 'USD',
      timezone: 'America/New_York',
    },
  });
  await seedDefaultCategories(db, user.id);

  const accounts = createAccountsService(db);
  const transactions = createTransactionsService(db);

  const ids = new Map<AccountKey, string>();
  for (const a of DEMO_ACCOUNTS) {
    const created = await accounts.create(user.id, {
      name: a.name,
      type: a.type,
      institution: a.institution,
      currency: 'USD',
      initialBalance: a.initialBalance,
      color: a.color,
      icon: a.icon,
    });
    ids.set(a.key, created.id);
  }

  const categories = new Map(
    (await db.category.findMany({ where: { userId: user.id } })).map((c) => [
      `${c.type}:${c.name}`,
      c.id,
    ]),
  );

  const demo = buildDemoTransactions(today);
  const createdIds: string[] = [];
  for (const t of demo) {
    const categoryType = t.isRefund ? 'expense' : t.type;
    const categoryId = t.category ? categories.get(`${categoryType}:${t.category}`) : undefined;
    if (t.category && !categoryId)
      throw new Error(`Demo data uses unknown category "${t.category}"`);
    const created = await transactions.create(user.id, {
      type: t.type,
      accountId: ids.get(t.account)!,
      categoryId: categoryId ?? null,
      amount: t.amount,
      description: t.description,
      merchant: t.merchant ?? null,
      date: t.date,
      notes: null,
      transferAccountId: t.toAccount ? ids.get(t.toAccount)! : null,
      transferAmount: null,
      isRefund: t.isRefund ?? false,
    });
    createdIds.push(created.id);
  }

  const todayIso = todayInZone(today, 'America/New_York');

  // Recurring rules, each anchored to its first demo occurrence, with the history linked to it.
  for (const r of DEMO_RECURRING) {
    const indexes = demo.flatMap((t, i) =>
      t.description === r.description && t.account === r.account && t.type === r.type ? [i] : [],
    );
    const first = demo[indexes[0]!];
    const last = demo[indexes[indexes.length - 1]!];
    if (!first || !last) throw new Error(`Demo recurring "${r.description}" has no history`);
    const anchor = [...indexes.map((i) => demo[i]!.date)].sort()[0]!;
    const rule = await db.recurringTransaction.create({
      data: {
        userId: user.id,
        accountId: ids.get(r.account)!,
        categoryId: categories.get(`${r.type}:${first.category}`) ?? null,
        type: r.type,
        amount: fromMinor(last.amount),
        currency: 'USD',
        description: r.description,
        frequency: 'monthly',
        interval: 1,
        startDate: fromIsoDate(anchor),
        nextOccurrence: fromIsoDate(
          nextAfter({ frequency: 'monthly', interval: 1, anchor }, todayIso),
        ),
      },
    });
    await db.transaction.updateMany({
      where: { id: { in: indexes.map((i) => createdIds[i]!) } },
      data: { isRecurring: true, recurringTransactionId: rule.id },
    });
  }
  // Monthly budgets for the categories people actually watch, in force since three months ago.
  const budgetsSince = addMonths(todayIso.slice(0, 7) + '-01', -3);
  const budgets = createBudgetsService(db, () => today);
  const demoBudgets: [string, number][] = [
    ['Food', 60_000],
    ['Transport', 12_000],
    ['Entertainment', 10_000],
    ['Shopping', 20_000],
  ];
  for (const [name, amount] of demoBudgets) {
    const categoryId = categories.get(`expense:${name}`);
    if (!categoryId) throw new Error(`Demo budget uses unknown category "${name}"`);
    await budgets.create(user.id, {
      categoryId,
      amount,
      period: 'monthly',
      alertThreshold: 80,
      startDate: budgetsSince,
    });
  }

  // Savings goals with a believable history of regular contributions.
  const goals = createGoalsService(db, () => today);
  const demoGoals = [
    // name, target, months until deadline (null = open-ended), color, contributions as [months ago, amount]
    {
      name: 'Emergency Fund',
      target: 500_000,
      months: 9,
      color: '#2e6b4b',
      parts: [
        [8, 40_000],
        [7, 40_000],
        [6, 40_000],
        [5, 40_000],
        [4, 40_000],
        [3, 40_000],
        [2, 40_000],
        [1, 40_000],
      ],
    },
    {
      name: 'Vacation',
      target: 240_000,
      months: 5,
      color: '#b98a2e',
      parts: [
        [3, 30_000],
        [2, 30_000],
        [1, 25_000],
      ],
    },
    {
      name: 'Laptop',
      target: 200_000,
      months: 4,
      color: '#5b6b84',
      parts: [
        [4, 30_000],
        [3, 30_000],
        [2, 30_000],
        [1, 30_000],
      ],
    },
  ] as const;
  for (const g of demoGoals) {
    const created = await goals.create(user.id, {
      name: g.name,
      targetAmount: g.target,
      deadline: addMonths(todayIso, g.months),
      color: g.color,
      icon: 'target',
    });
    for (const [monthsAgo, amount] of g.parts) {
      await goals.addContribution(user.id, created.id, {
        amount,
        date: addMonths(todayIso, -monthsAgo),
        note: 'Monthly saving',
      });
    }
  }
  const goalDrift = await goals.reconcile(user.id);
  if (goalDrift.length > 0)
    throw new Error(`Seed produced inconsistent goal totals: ${JSON.stringify(goalDrift)}`);

  const drift = await accounts.reconcile(user.id);
  if (drift.length > 0)
    throw new Error(`Seed produced inconsistent balances: ${JSON.stringify(drift)}`);

  const listed = await accounts.list(user.id);
  const checkingId = ids.get('checking')!;
  const checking = await db.account.findUniqueOrThrow({ where: { id: checkingId } });
  const history = balanceHistory(
    checkingId,
    toMinor(checking.initialBalance),
    await ledgerTxsForAccount(db, user.id, checkingId),
  );
  return {
    userId: user.id,
    transactions: demo.length,
    recurring: DEMO_RECURRING.length,
    budgets: demoBudgets.length,
    goals: demoGoals.length,
    accounts: listed.accounts.map((a) => ({ name: a.name, balance: a.currentBalance })),
    lowestCheckingBalance: Math.min(
      ...history.map((p) => p.balance),
      toMinor(checking.initialBalance),
    ),
  };
}
