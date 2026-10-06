import type { Budget, Category } from '@prisma/client';
import {
  budgetLifecycle,
  addMonths,
  budgetPeriodRange,
  computeBudgetState,
  endOfMonth,
  startOfMonth,
  describeBudget,
  formatMoney,
  isCurrencyCode,
  money,
  previousPeriods,
  todayInZone,
  type BudgetPeriodKind,
  type CurrencyCode,
  type DateRange,
} from '@pfm/finance';
import type {
  BudgetDetailDto,
  BudgetPerformanceDto,
  BudgetDto,
  BudgetListDto,
  CreateBudgetInput,
  UpdateBudgetInput,
} from '@pfm/validation';
import { fromIsoDate, fromMinor, toIsoDate, toMinor } from '../../lib/convert';
import type { Db } from '../../lib/db';
import { AppError } from '../../utils/errors';

const asCurrency = (c: string): CurrencyCode => (isCurrencyCode(c) ? c : 'USD');

interface SpendRow {
  type: 'income' | 'expense' | 'transfer';
  amount: number;
  date: string;
  categoryId: string | null;
  isRefund: boolean;
  currency: string;
}

/** Net spending and number of purchases for a set of categories within a date range. */
function spendIn(
  rows: readonly SpendRow[],
  categoryIds: ReadonlySet<string>,
  range: DateRange,
  currency: CurrencyCode,
) {
  let spent = 0;
  let count = 0;
  for (const r of rows) {
    if (r.currency !== currency || r.categoryId === null || !categoryIds.has(r.categoryId))
      continue;
    if (r.date < range.from || r.date > range.to) continue;
    if (r.type === 'expense') {
      spent += r.amount;
      count += 1;
    } else if (r.type === 'income' && r.isRefund) {
      spent -= r.amount;
    }
  }
  return { spent, count };
}

export function createBudgetsService(db: Db, now: () => Date) {
  async function userContext(userId: string) {
    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) throw AppError.unauthorized();
    return {
      currency: asCurrency(user.currency),
      locale: user.locale,
      today: todayInZone(now(), user.timezone),
    };
  }

  async function findOwned(userId: string, id: string): Promise<Budget> {
    const budget = await db.budget.findFirst({ where: { id, userId } });
    if (!budget) throw AppError.notFound('That budget');
    return budget;
  }

  /** A budget on "Food" covers Food and every subcategory; on "Coffee" just Coffee. */
  function coveredIds(category: Category, all: readonly Category[]): Set<string> {
    const ids = new Set([category.id]);
    for (const c of all) if (c.parentId === category.id) ids.add(c.id);
    return ids;
  }

  async function assertNoDuplicate(
    userId: string,
    categoryId: string,
    period: BudgetPeriodKind,
    today: string,
    exceptId?: string,
  ) {
    const existing = await db.budget.findMany({
      where: { userId, categoryId, period, ...(exceptId ? { id: { not: exceptId } } : {}) },
    });
    const live = existing.find(
      (b) =>
        budgetLifecycle(toIsoDate(b.startDate), b.endDate ? toIsoDate(b.endDate) : null, today) !==
        'ended',
    );
    if (live) {
      throw AppError.conflict(
        `You already have a ${period} budget for this category. Edit that one instead.`,
        'budget_exists',
      );
    }
  }

  function toDto(
    budget: Budget,
    category: Category,
    parent: Category | undefined,
    spend: { spent: number; count: number },
    ctx: { today: string; locale: string },
  ): BudgetDto {
    const currency = asCurrency(budget.currency);
    const period = budget.period as BudgetPeriodKind;
    const range = budgetPeriodRange(period, ctx.today);
    const state = computeBudgetState({
      limit: toMinor(budget.amount),
      spent: spend.spent,
      period: range,
      today: ctx.today,
      transactionCount: spend.count,
      alertThreshold: budget.alertThreshold,
      currency,
    });
    const text = describeBudget(state, (minor) =>
      formatMoney(money(Math.abs(minor), currency), { locale: ctx.locale, compactFraction: true }),
    );
    const startDate = toIsoDate(budget.startDate);
    const endDate = budget.endDate ? toIsoDate(budget.endDate) : null;
    return {
      id: budget.id,
      categoryId: category.id,
      categoryName: category.name,
      categoryColor: category.color,
      parentCategoryName: parent?.name ?? null,
      amount: toMinor(budget.amount),
      currency,
      period,
      alertThreshold: budget.alertThreshold,
      startDate,
      endDate,
      lifecycle: budgetLifecycle(startDate, endDate, ctx.today),
      periodFrom: range.from,
      periodTo: range.to,
      spent: state.spent,
      remaining: state.remaining,
      usedBp: state.usedBp,
      elapsedBp: state.elapsedBp,
      daysTotal: state.daysTotal,
      daysElapsed: state.daysElapsed,
      daysRemaining: state.daysRemaining,
      projectedSpent: state.projectedSpent,
      projectedOver: state.projectedOver,
      dailyAllowance: state.dailyAllowance,
      status: state.status,
      headline: text.headline,
      detail: text.detail,
    };
  }

  /** One query for all the spending any budget could need, kept lean. */
  async function loadSpend(userId: string, from: string, to: string): Promise<SpendRow[]> {
    const rows = await db.transaction.findMany({
      where: {
        userId,
        type: { not: 'transfer' },
        date: { gte: fromIsoDate(from), lte: fromIsoDate(to) },
      },
      select: {
        type: true,
        amount: true,
        date: true,
        categoryId: true,
        isRefund: true,
        currency: true,
      },
    });
    return rows.map((r) => ({ ...r, amount: toMinor(r.amount), date: toIsoDate(r.date) }));
  }

  return {
    async list(userId: string): Promise<BudgetListDto> {
      const ctx = await userContext(userId);
      const [budgets, categories] = await Promise.all([
        db.budget.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
        db.category.findMany({ where: { userId } }),
      ]);
      const byId = new Map(categories.map((c) => [c.id, c]));
      const ranges = budgets.map((b) => budgetPeriodRange(b.period as BudgetPeriodKind, ctx.today));
      const earliest = ranges.reduce((min, r) => (r.from < min ? r.from : min), ctx.today);
      const rows = budgets.length > 0 ? await loadSpend(userId, earliest, ctx.today) : [];

      const dtos = budgets.flatMap((b, i) => {
        const category = byId.get(b.categoryId);
        if (!category) return [];
        const spend = spendIn(
          rows,
          coveredIds(category, categories),
          ranges[i]!,
          asCurrency(b.currency),
        );
        return [
          toDto(
            b,
            category,
            category.parentId ? byId.get(category.parentId) : undefined,
            spend,
            ctx,
          ),
        ];
      });

      const monthly = dtos.filter(
        (b) => b.period === 'monthly' && b.lifecycle === 'active' && b.currency === ctx.currency,
      );
      return {
        budgets: dtos,
        monthly:
          monthly.length > 0
            ? {
                currency: ctx.currency,
                budgeted: monthly.reduce((s, b) => s + b.amount, 0),
                spent: monthly.reduce((s, b) => s + b.spent, 0),
                count: monthly.length,
              }
            : null,
      };
    },

    async get(userId: string, id: string): Promise<BudgetDetailDto> {
      const ctx = await userContext(userId);
      const budget = await findOwned(userId, id);
      const categories = await db.category.findMany({ where: { userId } });
      const category = categories.find((c) => c.id === budget.categoryId);
      if (!category) throw AppError.notFound('That budget');
      const period = budget.period as BudgetPeriodKind;
      const past = previousPeriods(period, ctx.today, 6);
      const earliest = past[past.length - 1]!.from;
      const rows = await loadSpend(userId, earliest, ctx.today);
      const ids = coveredIds(category, categories);
      const currency = asCurrency(budget.currency);
      const current = spendIn(rows, ids, budgetPeriodRange(period, ctx.today), currency);
      const parent = category.parentId
        ? categories.find((c) => c.id === category.parentId)
        : undefined;
      const limit = toMinor(budget.amount);
      return {
        ...toDto(budget, category, parent, current, ctx),
        history: past.map((range) => {
          const { spent } = spendIn(rows, ids, range, currency);
          return { from: range.from, to: range.to, spent, limit, overBudget: spent > limit };
        }),
      };
    },

    async create(userId: string, input: CreateBudgetInput): Promise<BudgetDto> {
      const ctx = await userContext(userId);
      const category = await db.category.findFirst({ where: { id: input.categoryId, userId } });
      const problems: Record<string, string[]> = {};
      if (!category) problems.categoryId = ['Choose one of your categories.'];
      else if (category.type !== 'expense')
        problems.categoryId = ['Budgets track spending, so choose an expense category.'];
      else if (category.isArchived)
        problems.categoryId = ['That category is archived. Pick another.'];
      if (Object.keys(problems).length > 0) {
        throw AppError.badRequest('Some fields need attention.', 'validation_failed', problems);
      }
      await assertNoDuplicate(userId, input.categoryId, input.period, ctx.today);
      const created = await db.budget.create({
        data: {
          userId,
          categoryId: input.categoryId,
          amount: fromMinor(input.amount),
          currency: ctx.currency,
          period: input.period,
          alertThreshold: input.alertThreshold,
          startDate: fromIsoDate(input.startDate ?? ctx.today),
        },
      });
      const all = await db.category.findMany({ where: { userId } });
      const range = budgetPeriodRange(input.period, ctx.today);
      const rows = await loadSpend(userId, range.from, ctx.today);
      const spend = spendIn(rows, coveredIds(category!, all), range, ctx.currency);
      return toDto(
        created,
        category!,
        category!.parentId ? all.find((c) => c.id === category!.parentId) : undefined,
        spend,
        ctx,
      );
    },

    async update(userId: string, id: string, input: UpdateBudgetInput): Promise<BudgetDto> {
      const ctx = await userContext(userId);
      const existing = await findOwned(userId, id);
      if (input.period && input.period !== existing.period) {
        await assertNoDuplicate(userId, existing.categoryId, input.period, ctx.today, id);
      }
      if (input.endDate && input.endDate < toIsoDate(existing.startDate)) {
        throw AppError.badRequest(
          'The end date must be after the budget starts.',
          'validation_failed',
          {
            endDate: ['The end date must be after the budget starts.'],
          },
        );
      }
      await db.budget.update({
        where: { id },
        data: {
          ...(input.amount !== undefined ? { amount: fromMinor(input.amount) } : {}),
          ...(input.period !== undefined ? { period: input.period } : {}),
          ...(input.alertThreshold !== undefined ? { alertThreshold: input.alertThreshold } : {}),
          ...(input.endDate !== undefined
            ? { endDate: input.endDate ? fromIsoDate(input.endDate) : null }
            : {}),
        },
      });
      const list = await this.list(userId);
      const dto = list.budgets.find((b) => b.id === id);
      if (!dto) throw AppError.notFound('That budget');
      return dto;
    },

    /** Monthly budgets over the last `months` months (the current one is partial). */
    async performance(userId: string, months: number): Promise<BudgetPerformanceDto> {
      const ctx = await userContext(userId);
      const [budgets, categories] = await Promise.all([
        db.budget.findMany({ where: { userId, period: 'monthly' }, orderBy: { createdAt: 'asc' } }),
        db.category.findMany({ where: { userId } }),
      ]);
      const first = addMonths(startOfMonth(ctx.today), -(months - 1));
      const monthRanges = Array.from({ length: months }, (_, i) => {
        const from = addMonths(first, i);
        const full = endOfMonth(from);
        return { from, to: full > ctx.today ? ctx.today : full, partial: full > ctx.today };
      });
      const byId = new Map(categories.map((c) => [c.id, c]));
      const usable = budgets.filter(
        (b) => asCurrency(b.currency) === ctx.currency && byId.has(b.categoryId),
      );
      const rows = usable.length > 0 ? await loadSpend(userId, first, ctx.today) : [];

      const results = usable.map((b) => {
        const category = byId.get(b.categoryId)!;
        const ids = coveredIds(category, categories);
        const startMonth = startOfMonth(toIsoDate(b.startDate));
        const endMonth = b.endDate ? startOfMonth(toIsoDate(b.endDate)) : null;
        const limit = toMinor(b.amount);
        return {
          id: b.id,
          name: category.name,
          limit,
          results: monthRanges.map((m) => {
            if (m.from < startMonth || (endMonth !== null && m.from > endMonth)) return null;
            const { spent } = spendIn(rows, ids, m, ctx.currency);
            return { spent, over: spent > limit };
          }),
        };
      });

      let monthsEvaluated = 0;
      let monthsWithinBudget = 0;
      monthRanges.forEach((m, i) => {
        if (m.partial) return;
        const applicable = results
          .map((r) => r.results[i])
          .filter((r): r is { spent: number; over: boolean } => r !== null && r !== undefined);
        if (applicable.length === 0) return;
        monthsEvaluated += 1;
        if (applicable.every((r) => !r.over)) monthsWithinBudget += 1;
      });

      return {
        currency: ctx.currency,
        months: monthRanges,
        budgets: results,
        monthsWithinBudget,
        monthsEvaluated,
      };
    },

    async remove(userId: string, id: string): Promise<void> {
      await findOwned(userId, id);
      await db.budget.delete({ where: { id } });
    },
  };
}

export type BudgetsService = ReturnType<typeof createBudgetsService>;
