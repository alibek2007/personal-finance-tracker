import type { Prisma } from '@prisma/client';
import {
  addDays,
  addMonths,
  balanceSeries,
  bucketUnit,
  buildBuckets,
  cashFlow,
  categoryBreakdown,
  changeBp,
  cumulativeSeries,
  generateInsights,
  inCurrency,
  isCurrencyCode,
  monthlyComparison,
  monthWindows,
  previousRange,
  rangeForPreset,
  spendingTrend,
  startOfMonth,
  summarize,
  summarizeBalances,
  todayInZone,
  type CurrencyCode,
  type DateRange,
  type LedgerTx,
  type ReportTx,
} from '@pfm/finance';
import type {
  AnalyticsQuery,
  BalancesDto,
  CashFlowDto,
  CategoryBreakdownDto,
  MonthlyDto,
  MonthlyQuery,
  OverviewDto,
  SavingsProgressDto,
  SpendingTrendDto,
  SummaryDto,
} from '@pfm/validation';
import { fromIsoDate, toIsoDate, toMinor, toMinorOrNull } from '../../lib/convert';
import type { Db } from '../../lib/db';
import { AppError } from '../../utils/errors';
import { subscriptionTotals } from '../recurring/recurring.service';

interface Filters {
  accountId?: string | undefined;
  categoryId?: string | undefined;
  type?: 'income' | 'expense' | undefined;
}

const asCurrency = (code: string): CurrencyCode => (isCurrencyCode(code) ? code : 'USD');

export function createAnalyticsService(db: Db, now: () => Date) {
  async function userContext(userId: string) {
    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) throw AppError.unauthorized();
    return {
      currency: asCurrency(user.currency),
      timezone: user.timezone,
      locale: user.locale,
      today: todayInZone(now(), user.timezone),
    };
  }

  /** Lean rows only; transfers are excluded in the query because no report counts them. */
  async function loadTxs(
    userId: string,
    range: DateRange,
    filters: Filters = {},
  ): Promise<ReportTx[]> {
    let categoryIds: string[] | undefined;
    if (filters.categoryId) {
      const root = await db.category.findFirst({ where: { id: filters.categoryId, userId } });
      if (!root) return [];
      const kids = await db.category.findMany({
        where: { userId, parentId: root.id },
        select: { id: true },
      });
      categoryIds = [root.id, ...kids.map((k) => k.id)];
    }
    const where: Prisma.TransactionWhereInput = {
      userId,
      type: filters.type ? filters.type : { not: 'transfer' },
      date: { gte: fromIsoDate(range.from), lte: fromIsoDate(range.to) },
      ...(filters.accountId ? { accountId: filters.accountId } : {}),
      ...(categoryIds ? { categoryId: { in: categoryIds } } : {}),
    };
    const rows = await db.transaction.findMany({
      where,
      select: {
        type: true,
        amount: true,
        currency: true,
        date: true,
        categoryId: true,
        isRefund: true,
      },
    });
    return rows.map((r) => ({
      type: r.type,
      amount: toMinor(r.amount),
      currency: asCurrency(r.currency),
      date: toIsoDate(r.date),
      categoryId: r.categoryId,
      isRefund: r.isRefund,
    }));
  }

  async function categoryMeta(userId: string) {
    const rows = await db.category.findMany({ where: { userId } });
    return rows.map((c) => ({ id: c.id, name: c.name, color: c.color, parentId: c.parentId }));
  }

  function resolveRange(query: AnalyticsQuery, today: string): DateRange {
    if (query.range === 'custom') return { from: query.from!, to: query.to! };
    return rangeForPreset(query.range, today);
  }

  return {
    async overview(userId: string): Promise<OverviewDto> {
      const ctx = await userContext(userId);
      const w = monthWindows(ctx.today);
      const [txs, accounts, anyTx] = await Promise.all([
        loadTxs(userId, { from: w.previousFull.from, to: ctx.today }),
        db.account.findMany({ where: { userId } }),
        db.transaction.count({ where: { userId } }),
      ]);
      const { counted } = inCurrency(txs, ctx.currency);
      const categories = await categoryMeta(userId);

      const current = summarize(counted, w.current);
      const prevSame = summarize(counted, w.previousSamePeriod);
      const prevFull = summarize(counted, w.previousFull);
      const remainder = summarize(counted, {
        from: addDays(w.previousSamePeriod.to, 1),
        to: w.previousFull.to,
      });

      const slicesFor = (range: DateRange) =>
        categoryBreakdown(
          counted.filter((t) => t.date >= range.from && t.date <= range.to),
          categories,
        ).slices;

      const totals = summarizeBalances(
        accounts.map((a) => ({
          currency: asCurrency(a.currency),
          balance: toMinor(a.currentBalance),
          isArchived: a.isArchived,
        })),
      );
      const mine = totals.find((t) => t.currency === ctx.currency);

      const insights = generateInsights({
        currency: ctx.currency,
        locale: ctx.locale,
        daysElapsed: w.daysElapsed,
        daysInMonth: w.daysInMonth,
        thisMonth: { summary: current, slices: slicesFor(w.current) },
        lastSamePeriod: { summary: prevSame, slices: slicesFor(w.previousSamePeriod) },
        lastFull: prevFull,
        lastRemainder: { income: remainder.income, spent: remainder.spent },
        subscriptions: await subscriptionTotals(db, userId, ctx.currency),
      });

      const brief = (s: typeof current) => ({
        income: s.income,
        spent: s.spent,
        saved: s.saved,
        savingsRateBp: s.savingsRateBp,
      });
      return {
        currency: ctx.currency,
        today: ctx.today,
        totalBalance: mine?.netWorth ?? 0,
        otherCurrencies: totals.filter((t) => t.currency !== ctx.currency).map((t) => t.currency),
        hasTransactions: anyTx > 0,
        month: {
          ...brief(current),
          ...w.current,
          daysElapsed: w.daysElapsed,
          daysInMonth: w.daysInMonth,
        },
        previous: { ...brief(prevSame), ...w.previousSamePeriod },
        changes: {
          incomeBp: changeBp(current.income, prevSame.income),
          spentBp: changeBp(current.spent, prevSame.spent),
          savedBp: changeBp(current.saved, prevSame.saved),
        },
        insights,
      };
    },

    async cashFlow(userId: string, query: AnalyticsQuery): Promise<CashFlowDto> {
      const ctx = await userContext(userId);
      const range = resolveRange(query, ctx.today);
      const txs = await loadTxs(userId, range, query);
      const { counted, excludedCurrencies } = inCurrency(txs, ctx.currency);
      const unit = bucketUnit(range);
      const points = cashFlow(counted, buildBuckets(range, unit));
      const s = summarize(counted, range);
      return {
        currency: ctx.currency,
        ...range,
        unit,
        points,
        totals: {
          income: s.income,
          spent: s.spent,
          saved: s.saved,
          savingsRateBp: s.savingsRateBp,
        },
        excludedCurrencies,
      };
    },

    async categories(userId: string, query: AnalyticsQuery): Promise<CategoryBreakdownDto> {
      const ctx = await userContext(userId);
      const range = resolveRange(query, ctx.today);
      // A breakdown is about spending, so income-only filters make no sense here.
      const txs = await loadTxs(userId, range, { ...query, type: undefined });
      const { counted, excludedCurrencies } = inCurrency(txs, ctx.currency);
      const { slices, total } = categoryBreakdown(counted, await categoryMeta(userId));
      return { currency: ctx.currency, ...range, total, slices, excludedCurrencies };
    },

    async summary(userId: string, query: AnalyticsQuery): Promise<SummaryDto> {
      const ctx = await userContext(userId);
      const range = resolveRange(query, ctx.today);
      const before = previousRange(range);
      const [txs, earliest] = await Promise.all([
        loadTxs(userId, { from: before.from, to: range.to }, query),
        db.transaction.aggregate({ where: { userId }, _min: { date: true } }),
      ]);
      const { counted, excludedCurrencies } = inCurrency(txs, ctx.currency);
      const brief = (r: DateRange) => {
        const x = summarize(counted, r);
        return {
          ...r,
          income: x.income,
          spent: x.spent,
          saved: x.saved,
          savingsRateBp: x.savingsRateBp,
        };
      };
      const current = brief(range);
      const previous = brief(before);
      return {
        currency: ctx.currency,
        current,
        previous,
        changes: {
          incomeBp: changeBp(current.income, previous.income),
          spentBp: changeBp(current.spent, previous.spent),
          savedBp: changeBp(current.saved, previous.saved),
        },
        dataStartsOn: earliest._min.date ? toIsoDate(earliest._min.date) : null,
        excludedCurrencies,
      };
    },

    async spendingTrend(userId: string, query: AnalyticsQuery): Promise<SpendingTrendDto> {
      const ctx = await userContext(userId);
      const range = resolveRange(query, ctx.today);
      const txs = await loadTxs(userId, range, { ...query, type: undefined });
      const { counted, excludedCurrencies } = inCurrency(txs, ctx.currency);
      const unit = bucketUnit(range);
      const { series, points } = spendingTrend(
        counted,
        await categoryMeta(userId),
        buildBuckets(range, unit),
      );
      return { currency: ctx.currency, ...range, unit, series, points, excludedCurrencies };
    },

    async monthly(userId: string, query: MonthlyQuery): Promise<MonthlyDto> {
      const ctx = await userContext(userId);
      // One month further back than the first row, so that row has something to compare with.
      const first = addMonths(startOfMonth(ctx.today), -query.months);
      const txs = await loadTxs(userId, { from: first, to: ctx.today }, query);
      const { counted, excludedCurrencies } = inCurrency(txs, ctx.currency);
      return {
        currency: ctx.currency,
        months: monthlyComparison(counted, ctx.today, query.months),
        excludedCurrencies,
      };
    },

    /** Net worth over time (debts subtract), plus each account's own line. Only the main currency. */
    async balances(userId: string, query: AnalyticsQuery): Promise<BalancesDto> {
      const ctx = await userContext(userId);
      const range = resolveRange(query, ctx.today);
      const all = await db.account.findMany({
        where: { userId, ...(query.accountId ? { id: query.accountId } : {}) },
      });
      const mine = all.filter((a) => asCurrency(a.currency) === ctx.currency);
      const excludedCurrencies = [
        ...new Set(all.map((a) => asCurrency(a.currency)).filter((c) => c !== ctx.currency)),
      ].sort();
      const unit = bucketUnit(range);
      const dates = buildBuckets(range, unit).map((b) => b.end);

      const ids = mine.map((a) => a.id);
      const rows =
        ids.length === 0
          ? []
          : await db.transaction.findMany({
              where: {
                userId,
                date: { lte: fromIsoDate(range.to) },
                OR: [{ accountId: { in: ids } }, { transferAccountId: { in: ids } }],
              },
              select: {
                type: true,
                amount: true,
                accountId: true,
                transferAccountId: true,
                transferAmount: true,
                date: true,
              },
            });
      const ledger: (LedgerTx & { date: string })[] = rows.map((r) => ({
        type: r.type,
        accountId: r.accountId,
        amount: toMinor(r.amount),
        transferAccountId: r.transferAccountId,
        transferAmount: toMinorOrNull(r.transferAmount),
        date: toIsoDate(r.date),
      }));
      const points = balanceSeries(
        mine.map((a) => ({ id: a.id, initialBalance: toMinor(a.initialBalance) })),
        ledger,
        dates,
      );
      // Hide archived accounts that never held anything in the window.
      const shown = mine.filter(
        (a) => !a.isArchived || points.some((p) => (p.byAccount[a.id] ?? 0) !== 0),
      );
      return {
        currency: ctx.currency,
        ...range,
        unit,
        accounts: shown.map((a) => ({ id: a.id, name: a.name, color: a.color, type: a.type })),
        points: points.map((p) => ({
          date: p.date,
          total: shown.reduce((sum, a) => sum + (p.byAccount[a.id] ?? 0), 0),
          byAccount: Object.fromEntries(shown.map((a) => [a.id, p.byAccount[a.id] ?? 0])),
        })),
        excludedCurrencies,
      };
    },

    /** How much has been set aside toward goals over time, and where each goal stands now. */
    async savings(userId: string, query: AnalyticsQuery): Promise<SavingsProgressDto> {
      const ctx = await userContext(userId);
      const range = resolveRange(query, ctx.today);
      const goals = (
        await db.savingsGoal.findMany({
          where: { userId, isArchived: false },
          orderBy: { createdAt: 'asc' },
        })
      ).filter((g) => asCurrency(g.currency) === ctx.currency);
      const contributions = goals.length
        ? await db.goalContribution.findMany({
            where: {
              userId,
              goalId: { in: goals.map((g) => g.id) },
              date: { lte: fromIsoDate(range.to) },
            },
            select: { amount: true, date: true },
          })
        : [];
      const unit = bucketUnit(range);
      const dates = buildBuckets(range, unit).map((b) => b.end);
      const totals = cumulativeSeries(
        contributions.map((c) => ({ date: toIsoDate(c.date), amount: toMinor(c.amount) })),
        dates,
      );
      return {
        currency: ctx.currency,
        ...range,
        unit,
        points: dates.map((date, i) => ({ date, total: totals[i] ?? 0 })),
        goals: goals.map((g) => {
          const current = toMinor(g.currentAmount);
          const target = toMinor(g.targetAmount);
          return {
            id: g.id,
            name: g.name,
            color: g.color,
            current,
            target,
            progressBp: Math.round((current * 10000) / target),
          };
        }),
      };
    },
  };
}

export type AnalyticsService = ReturnType<typeof createAnalyticsService>;
