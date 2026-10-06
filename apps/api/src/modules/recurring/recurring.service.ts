import { Prisma, type Category, type RecurringTransaction } from '@prisma/client';
import {
  describeCadence,
  dueDates,
  isCurrencyCode,
  monthlyEquivalent,
  nextAfter,
  nextOnOrAfter,
  occurrencesBetween,
  todayInZone,
  yearlyEquivalent,
  type CurrencyCode,
  type Recurrence,
  type RecurrenceFrequency,
} from '@pfm/finance';
import type {
  CreateRecurringInput,
  OccurrenceDto,
  RecurringDto,
  RecurringListDto,
  UpdateRecurringInput,
} from '@pfm/validation';
import { fromIsoDate, fromMinor, toIsoDate, toMinor } from '../../lib/convert';
import type { Db } from '../../lib/db';
import { AppError } from '../../utils/errors';
import type { TransactionsService } from '../transactions/transactions.service';

const asCurrency = (c: string): CurrencyCode => (isCurrencyCode(c) ? c : 'USD');
const SUBSCRIPTIONS = 'subscriptions';

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/** A recurring expense is a "subscription" when its category (or its parent) is called Subscriptions. */
function isSubscriptionCategory(
  category: Category | undefined,
  all: Map<string, Category>,
): boolean {
  if (!category) return false;
  if (category.name.toLowerCase() === SUBSCRIPTIONS) return true;
  const parent = category.parentId ? all.get(category.parentId) : undefined;
  return parent?.name.toLowerCase() === SUBSCRIPTIONS;
}

const recurrenceOf = (r: RecurringTransaction): Recurrence => ({
  frequency: r.frequency as RecurrenceFrequency,
  interval: r.interval,
  anchor: toIsoDate(r.startDate),
});

export function createRecurringService(db: Db, now: () => Date, transactions: TransactionsService) {
  async function userContext(userId: string) {
    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) throw AppError.unauthorized();
    return { currency: asCurrency(user.currency), today: todayInZone(now(), user.timezone) };
  }

  async function findOwned(userId: string, id: string): Promise<RecurringTransaction> {
    const rule = await db.recurringTransaction.findFirst({ where: { id, userId } });
    if (!rule) throw AppError.notFound('That recurring payment');
    return rule;
  }

  const fieldError = (field: string, message: string) =>
    AppError.badRequest('Some fields need attention.', 'validation_failed', { [field]: [message] });

  /** Account/category must be the user's, usable, and the right kind for the payment. */
  async function checkReferences(
    userId: string,
    type: 'income' | 'expense',
    accountId: string,
    categoryId: string | null | undefined,
    existing?: RecurringTransaction,
  ) {
    const [account, category] = await Promise.all([
      db.account.findFirst({ where: { id: accountId, userId } }),
      categoryId ? db.category.findFirst({ where: { id: categoryId, userId } }) : null,
    ]);
    if (!account) throw fieldError('accountId', 'Choose one of your accounts.');
    if (account.isArchived && existing?.accountId !== account.id) {
      throw fieldError('accountId', 'That account is archived. Restore it or pick another.');
    }
    if (categoryId) {
      if (!category) throw fieldError('categoryId', 'Choose one of your categories.');
      if (category.type !== type) {
        throw fieldError(
          'categoryId',
          `Pick ${type === 'income' ? 'an income' : 'an expense'} category.`,
        );
      }
      if (category.isArchived && existing?.categoryId !== category.id) {
        throw fieldError('categoryId', 'That category is archived. Pick another.');
      }
    }
    return account;
  }

  async function toDtos(
    userId: string,
    rules: RecurringTransaction[],
    today: string,
  ): Promise<RecurringDto[]> {
    const [categories, accounts] = await Promise.all([
      db.category.findMany({ where: { userId } }),
      db.account.findMany({ where: { userId } }),
    ]);
    const catById = new Map(categories.map((c) => [c.id, c]));
    const accById = new Map(accounts.map((a) => [a.id, a]));
    return rules.map((r) => {
      const amount = toMinor(r.amount);
      const category = r.categoryId ? catById.get(r.categoryId) : undefined;
      const account = accById.get(r.accountId);
      const endDate = r.endDate ? toIsoDate(r.endDate) : null;
      const next = toIsoDate(r.nextOccurrence);
      return {
        id: r.id,
        type: r.type === 'income' ? 'income' : 'expense',
        description: r.description,
        amount,
        currency: asCurrency(r.currency),
        accountId: r.accountId,
        categoryId: r.categoryId,
        frequency: r.frequency,
        interval: r.interval,
        cadence: describeCadence(r.frequency, r.interval),
        nextOccurrence: next,
        endDate,
        isActive: r.isActive,
        hasEnded: endDate !== null && (endDate < today || next > endDate),
        monthlyCost: monthlyEquivalent(amount, r.frequency, r.interval),
        yearlyCost: yearlyEquivalent(amount, r.frequency, r.interval),
        isSubscription: r.type === 'expense' && isSubscriptionCategory(category, catById),
        blocked: account?.isArchived
          ? 'account_archived'
          : category?.isArchived
            ? 'category_archived'
            : null,
      };
    });
  }

  /** Records every payment that has come due. Safe to run any number of times, concurrently. */
  async function materialize(userId: string): Promise<{ created: number }> {
    const ctx = await userContext(userId);
    const due = await db.recurringTransaction.findMany({
      where: { userId, isActive: true, nextOccurrence: { lte: fromIsoDate(ctx.today) } },
    });
    let created = 0;
    for (const rule of due) {
      const rec = recurrenceOf(rule);
      const endDate = rule.endDate ? toIsoDate(rule.endDate) : null;
      const dates = dueDates(rec, toIsoDate(rule.nextOccurrence), ctx.today, endDate);
      let cursor = toIsoDate(rule.nextOccurrence);
      for (const date of dates) {
        try {
          await transactions.create(
            userId,
            {
              type: rule.type === 'income' ? 'income' : 'expense',
              accountId: rule.accountId,
              categoryId: rule.categoryId,
              amount: toMinor(rule.amount),
              description: rule.description,
              date,
              merchant: null,
              notes: null,
              transferAccountId: null,
              transferAmount: null,
              isRefund: false,
            },
            { recurringTransactionId: rule.id },
          );
          created += 1;
        } catch (error) {
          // Already recorded (another process won the race): fine, just move on.
          if (!isUniqueViolation(error)) {
            // Anything else (archived account, deleted category...) leaves the rule due; the list flags it.
            if (error instanceof AppError) break;
            throw error;
          }
        }
        cursor = nextAfter(rec, date);
        await db.recurringTransaction.update({
          where: { id: rule.id },
          data: { nextOccurrence: fromIsoDate(cursor) },
        });
      }
      if (endDate !== null && cursor > endDate) {
        await db.recurringTransaction.update({ where: { id: rule.id }, data: { isActive: false } });
      }
    }
    return { created };
  }

  return {
    materialize,

    /** For the background job: everyone whose payments may be due (one day of slack covers every timezone). */
    async materializeAll(): Promise<{ users: number; created: number }> {
      const horizon = new Date(now().getTime() + 36 * 60 * 60 * 1000);
      const owners = await db.recurringTransaction.findMany({
        where: { isActive: true, nextOccurrence: { lte: horizon } },
        select: { userId: true },
        distinct: ['userId'],
      });
      let created = 0;
      for (const { userId } of owners) created += (await materialize(userId)).created;
      return { users: owners.length, created };
    },

    async list(userId: string): Promise<RecurringListDto> {
      const ctx = await userContext(userId);
      const rules = await db.recurringTransaction.findMany({
        where: { userId },
        orderBy: [{ isActive: 'desc' }, { nextOccurrence: 'asc' }, { createdAt: 'asc' }],
      });
      const items = await toDtos(userId, rules, ctx.today);
      const mine = items.filter((i) => i.currency === ctx.currency && i.isActive && !i.hasEnded);
      const sum = (pick: (i: RecurringDto) => number, where: (i: RecurringDto) => boolean) =>
        mine.filter(where).reduce((s, i) => s + pick(i), 0);
      const isExpense = (i: RecurringDto) => i.type === 'expense';
      const isIncome = (i: RecurringDto) => i.type === 'income';
      const isSub = (i: RecurringDto) => i.isSubscription;
      return {
        items,
        totals:
          mine.length > 0
            ? {
                currency: ctx.currency,
                activeCount: mine.length,
                monthlyExpenses: sum((i) => i.monthlyCost, isExpense),
                yearlyExpenses: sum((i) => i.yearlyCost, isExpense),
                monthlyIncome: sum((i) => i.monthlyCost, isIncome),
                yearlyIncome: sum((i) => i.yearlyCost, isIncome),
                subscriptionsMonthly: sum((i) => i.monthlyCost, isSub),
                subscriptionsYearly: sum((i) => i.yearlyCost, isSub),
                subscriptionsCount: mine.filter(isSub).length,
              }
            : null,
        excludedCurrencies: [
          ...new Set(items.map((i) => i.currency).filter((c) => c !== ctx.currency)),
        ].sort(),
      };
    },

    async create(userId: string, input: CreateRecurringInput): Promise<RecurringDto> {
      const ctx = await userContext(userId);
      if (input.nextOccurrence < ctx.today) {
        throw fieldError(
          'nextOccurrence',
          'Choose the date of the next payment: today or later. Past payments are not recorded for you.',
        );
      }
      if (input.endDate && input.endDate < input.nextOccurrence) {
        throw fieldError('endDate', 'The end date must be on or after the first payment.');
      }
      const account = await checkReferences(userId, input.type, input.accountId, input.categoryId);
      const rule = await db.recurringTransaction.create({
        data: {
          userId,
          accountId: input.accountId,
          categoryId: input.categoryId ?? null,
          type: input.type,
          amount: fromMinor(input.amount),
          currency: account.currency,
          description: input.description,
          frequency: input.frequency,
          interval: input.interval,
          startDate: fromIsoDate(input.nextOccurrence),
          nextOccurrence: fromIsoDate(input.nextOccurrence),
          endDate: input.endDate ? fromIsoDate(input.endDate) : null,
        },
      });
      const [dto] = await toDtos(userId, [rule], ctx.today);
      // A payment due today is recorded straight away.
      if (input.nextOccurrence === ctx.today) await materialize(userId);
      return dto!;
    },

    async update(userId: string, id: string, input: UpdateRecurringInput): Promise<RecurringDto> {
      const ctx = await userContext(userId);
      const existing = await findOwned(userId, id);
      const type = existing.type === 'income' ? 'income' : 'expense';
      const accountId = input.accountId ?? existing.accountId;
      const categoryId = input.categoryId !== undefined ? input.categoryId : existing.categoryId;
      const account = await checkReferences(userId, type, accountId, categoryId, existing);

      const frequency = (input.frequency ?? existing.frequency) as RecurrenceFrequency;
      const interval = input.interval ?? existing.interval;
      const scheduleChanged =
        input.frequency !== undefined ||
        input.interval !== undefined ||
        input.nextOccurrence !== undefined;
      const endDate =
        input.endDate !== undefined
          ? input.endDate
          : existing.endDate
            ? toIsoDate(existing.endDate)
            : null;

      if (input.nextOccurrence && input.nextOccurrence < ctx.today) {
        throw fieldError('nextOccurrence', 'Choose a date that is today or later.');
      }

      let anchor = toIsoDate(existing.startDate);
      let next = toIsoDate(existing.nextOccurrence);
      if (scheduleChanged) {
        // The date you choose becomes the new anchor. Without one, keep the next payment where it is (or, if
        // this rule has been sitting paused, the next date on or after today).
        anchor =
          input.nextOccurrence ??
          (next >= ctx.today ? next : nextOnOrAfter(recurrenceOf(existing), ctx.today));
        next = anchor;
      }

      let isActive = input.isActive ?? existing.isActive;
      if (input.isActive === true && !existing.isActive) {
        // Resuming skips what was missed while paused: no flood of back-dated payments.
        next = nextOnOrAfter({ frequency, interval, anchor }, ctx.today);
      }
      if (isActive && endDate !== null && next > endDate) {
        if (input.isActive === true) {
          throw AppError.conflict(
            'This payment has ended. Move its end date to resume it.',
            'ended',
          );
        }
        isActive = false;
      }
      const updated = await db.recurringTransaction.update({
        where: { id },
        data: {
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.amount !== undefined ? { amount: fromMinor(input.amount) } : {}),
          accountId,
          categoryId,
          currency: account.currency,
          frequency,
          interval,
          startDate: fromIsoDate(anchor),
          nextOccurrence: fromIsoDate(next),
          endDate: endDate ? fromIsoDate(endDate) : null,
          isActive,
        },
      });
      if (isActive && next === ctx.today) await materialize(userId);
      const fresh = await db.recurringTransaction.findUniqueOrThrow({ where: { id: updated.id } });
      const [dto] = await toDtos(userId, [fresh], ctx.today);
      return dto!;
    },

    /** Deleting stops future payments; transactions already recorded stay (they simply lose the link). */
    async remove(userId: string, id: string): Promise<void> {
      await findOwned(userId, id);
      await db.recurringTransaction.delete({ where: { id } });
    },

    /** Every payment still to come within [from, to], expanded from the active rules. */
    async occurrences(userId: string, from: string, to: string): Promise<OccurrenceDto[]> {
      const rules = await db.recurringTransaction.findMany({ where: { userId, isActive: true } });
      const out: OccurrenceDto[] = [];
      for (const r of rules) {
        const next = toIsoDate(r.nextOccurrence);
        const dates = occurrencesBetween(recurrenceOf(r), from > next ? from : next, to, {
          until: r.endDate ? toIsoDate(r.endDate) : null,
        });
        for (const date of dates) {
          out.push({
            ruleId: r.id,
            date,
            type: r.type === 'income' ? 'income' : 'expense',
            description: r.description,
            amount: toMinor(r.amount),
            currency: asCurrency(r.currency),
            accountId: r.accountId,
            categoryId: r.categoryId,
          });
        }
      }
      return out.sort(
        (a, b) => a.date.localeCompare(b.date) || a.description.localeCompare(b.description),
      );
    },
  };
}

export type RecurringService = ReturnType<typeof createRecurringService>;

/** Active subscriptions' cost, for the dashboard insight. */
export async function subscriptionTotals(db: Db, userId: string, currency: CurrencyCode) {
  const [rules, categories] = await Promise.all([
    db.recurringTransaction.findMany({
      where: { userId, isActive: true, type: 'expense', currency },
    }),
    db.category.findMany({ where: { userId } }),
  ]);
  const byId = new Map(categories.map((c) => [c.id, c]));
  const subs = rules.filter((r) =>
    isSubscriptionCategory(r.categoryId ? byId.get(r.categoryId) : undefined, byId),
  );
  return {
    count: subs.length,
    monthly: subs.reduce(
      (s, r) => s + monthlyEquivalent(toMinor(r.amount), r.frequency, r.interval),
      0,
    ),
    yearly: subs.reduce(
      (s, r) => s + yearlyEquivalent(toMinor(r.amount), r.frequency, r.interval),
      0,
    ),
  };
}
