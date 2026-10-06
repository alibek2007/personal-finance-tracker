import { currencyExponent, type CurrencyCode } from './currency';
import {
  addDays,
  addMonths,
  daysBetween,
  endOfMonth,
  parseIso,
  startOfMonth,
  startOfWeek,
  type DateRange,
} from './periods';

export type BudgetPeriodKind = 'weekly' | 'monthly' | 'yearly';

/**
 * Budgets repeat on calendar periods: Monday to Sunday, the calendar month, the calendar year.
 * Aligning to the calendar (rather than to the day a budget was created) makes "this month's
 * food budget" mean what people expect, and lets weeks span month ends naturally.
 */
export function budgetPeriodRange(period: BudgetPeriodKind, today: string): DateRange {
  switch (period) {
    case 'weekly': {
      const from = startOfWeek(today);
      return { from, to: addDays(from, 6) };
    }
    case 'monthly':
      return { from: startOfMonth(today), to: endOfMonth(today) };
    case 'yearly': {
      const { y } = parseIso(today);
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    }
  }
}

/** The n periods immediately before the current one, most recent first. */
export function previousPeriods(
  period: BudgetPeriodKind,
  today: string,
  count: number,
): DateRange[] {
  const out: DateRange[] = [];
  const current = budgetPeriodRange(period, today);
  for (let i = 1; i <= count; i++) {
    const anchor =
      period === 'weekly'
        ? addDays(current.from, -7 * i)
        : period === 'monthly'
          ? addMonths(current.from, -i)
          : addMonths(current.from, -12 * i);
    out.push(budgetPeriodRange(period, anchor));
  }
  return out;
}

export type BudgetLifecycle = 'upcoming' | 'active' | 'ended';

/** A budget applies from the period containing its start date until its (optional) end date. */
export function budgetLifecycle(
  startDate: string,
  endDate: string | null,
  today: string,
): BudgetLifecycle {
  if (startDate > today) return 'upcoming';
  if (endDate !== null && endDate < today) return 'ended';
  return 'active';
}

export type BudgetStatus = 'ok' | 'warning' | 'at_risk' | 'over';

export interface BudgetStatusInput {
  /** The limit for one period, in minor units. */
  limit: number;
  /** Net spend in the current period (refunds already subtracted). */
  spent: number;
  period: DateRange;
  today: string;
  /** Number of expense transactions behind `spent`. */
  transactionCount: number;
  /** Percent (1-100) of the limit at which to warn. */
  alertThreshold: number;
  currency: CurrencyCode;
}

export interface BudgetState {
  spent: number;
  limit: number;
  /** limit - spent; negative when over. */
  remaining: number;
  /** spent / limit in basis points (may exceed 10000). */
  usedBp: number;
  daysTotal: number;
  daysElapsed: number;
  daysRemaining: number;
  /** How far through the period we are, in basis points. */
  elapsedBp: number;
  /** Rest-of-period spend at the pace so far, when there is enough evidence to say; else null. */
  projectedSpent: number | null;
  /** By how much the projection exceeds the limit, when it does; else null. */
  projectedOver: number | null;
  /** What can be spent per remaining day without exceeding the limit. Null when over or the period is ending. */
  dailyAllowance: number | null;
  status: BudgetStatus;
}

/** A projection needs a real pattern: several purchases and a meaningful slice of the period. */
export const MIN_TRANSACTIONS_FOR_PROJECTION = 3;
export const MIN_ELAPSED_BP_FOR_PROJECTION = 2500;
/** Do not warn about projected overspend smaller than this share of the limit. */
const MIN_PROJECTED_OVER_BP = 300;

export function computeBudgetState(input: BudgetStatusInput): BudgetState {
  const { limit, spent, period, today, transactionCount, alertThreshold } = input;
  if (!Number.isSafeInteger(limit) || limit <= 0)
    throw new Error('A budget limit must be a positive amount');

  const daysTotal = daysBetween(period.from, period.to) + 1;
  const daysElapsed = Math.min(daysTotal, Math.max(1, daysBetween(period.from, today) + 1));
  const daysRemaining = daysTotal - daysElapsed;
  const elapsedBp = Math.round((daysElapsed * 10000) / daysTotal);
  const usedBp = Math.round((spent * 10000) / limit);
  const remaining = limit - spent;
  const over = spent > limit;

  let projectedSpent: number | null = null;
  let projectedOver: number | null = null;
  if (
    !over &&
    spent > 0 &&
    transactionCount >= MIN_TRANSACTIONS_FOR_PROJECTION &&
    elapsedBp >= MIN_ELAPSED_BP_FOR_PROJECTION
  ) {
    projectedSpent = spent + Math.round((spent * daysRemaining) / daysElapsed);
    const excess = projectedSpent - limit;
    if (excess > 0 && Math.round((excess * 10000) / limit) >= MIN_PROJECTED_OVER_BP)
      projectedOver = excess;
  }

  let status: BudgetStatus = 'ok';
  if (over) status = 'over';
  else if (usedBp >= alertThreshold * 100) status = 'warning';
  else if (projectedOver !== null) status = 'at_risk';

  return {
    spent,
    limit,
    remaining,
    usedBp,
    daysTotal,
    daysElapsed,
    daysRemaining,
    elapsedBp,
    projectedSpent,
    projectedOver,
    dailyAllowance: !over && daysRemaining > 0 ? Math.floor(remaining / daysRemaining) : null,
    status,
  };
}

export interface BudgetMessage {
  headline: string;
  detail: string | null;
}

/** Plain-language summary. `fmt` formats minor units (absolute value) in the user's currency. */
export function describeBudget(state: BudgetState, fmt: (minor: number) => string): BudgetMessage {
  const pct = `${Math.round(state.usedBp / 100)}%`;
  switch (state.status) {
    case 'over':
      return {
        headline: `Over by ${fmt(-state.remaining)}`,
        detail: `You've used ${pct} of this budget.`,
      };
    case 'warning':
      return {
        headline: `${fmt(state.remaining)} left`,
        detail:
          state.projectedOver !== null
            ? `You've used ${pct}. At your current pace, you may exceed this budget by ${fmt(state.projectedOver)}.`
            : `You've used ${pct} of this budget.`,
      };
    case 'at_risk':
      return {
        headline: `${fmt(state.remaining)} left`,
        detail: `At your current pace, you may exceed this budget by ${fmt(state.projectedOver ?? 0)}.`,
      };
    case 'ok': {
      if (state.remaining === state.limit)
        return { headline: `${fmt(state.remaining)} left`, detail: 'Nothing spent yet.' };
      if (state.daysRemaining === 0)
        return { headline: `${fmt(state.remaining)} left`, detail: 'Last day of this period.' };
      return {
        headline: `${fmt(state.remaining)} left`,
        detail:
          state.dailyAllowance !== null && state.dailyAllowance > 0
            ? `About ${fmt(state.dailyAllowance)} a day for ${state.daysRemaining} more day${state.daysRemaining === 1 ? '' : 's'}.`
            : null,
      };
    }
  }
}

/** Smallest difference worth mentioning for a currency (20 major units). Shared by insight rules. */
export const minMeaningfulAmount = (currency: CurrencyCode): number =>
  20 * 10 ** currencyExponent(currency);
