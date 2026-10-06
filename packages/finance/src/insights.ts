import { currencyExponent, type CurrencyCode } from './currency';
import { formatMoney, money } from './money';
import type { CategorySlice, Summary } from './reports';
import { changeBp } from './reports';

export interface Insight {
  /** Stable id so the UI can key and dedupe. */
  id: string;
  tone: 'positive' | 'negative' | 'neutral';
  text: string;
  /** Optional deep link target for the UI (category filter). */
  categoryId?: string | null;
}

export interface InsightInput {
  currency: CurrencyCode;
  locale: string;
  daysElapsed: number;
  daysInMonth: number;
  thisMonth: { summary: Summary; slices: CategorySlice[] };
  /** Same number of days at the start of last month. */
  lastSamePeriod: { summary: Summary; slices: CategorySlice[] };
  /** Whole of last month, used to extrapolate. */
  lastFull: Summary;
  /** Income / spending in the part of last month after the same point (for the projection). */
  lastRemainder: { income: number; spent: number };
  /** Active recurring subscriptions, normalised to a month and a year. */
  subscriptions?: { count: number; monthly: number; yearly: number } | null;
}

/** Insights need enough of a month behind them to be signal rather than noise. */
export const MIN_DAYS_FOR_TRENDS = 5;
/** "X is most of your spending" is only a finding once fixed costs like rent are not the whole picture. */
export const MIN_DAYS_FOR_CONCENTRATION = 10;
/** Ignore differences smaller than this many major currency units. */
const MIN_DIFF_UNITS = 20;
const MAX_INSIGHTS = 4;

const pct = (bp: number) => `${Math.round(Math.abs(bp) / 100)}%`;

/**
 * Observations computed from real figures only. Each rule states its own threshold; when the data
 * is too thin the rule stays silent, so an empty list is a valid, honest answer.
 */
export function generateInsights(input: InsightInput): Insight[] {
  const { currency, locale, thisMonth, lastSamePeriod } = input;
  const fmt = (minor: number) =>
    formatMoney(money(Math.abs(minor), currency), { locale, compactFraction: true });
  // Costs people will compare to a bill are shown to the cent; the others are rounded for readability.
  const exact = (minor: number) => formatMoney(money(Math.abs(minor), currency), { locale });
  const minDiff = MIN_DIFF_UNITS * 10 ** currencyExponent(currency);
  const out: (Insight & { weight: number })[] = [];

  if (input.daysElapsed >= MIN_DAYS_FOR_TRENDS) {
    // 1. Projection: if the rest of the month looks like last month's rest.
    if (input.lastFull.income > 0 || input.lastFull.spent > 0) {
      const projected =
        thisMonth.summary.saved + input.lastRemainder.income - input.lastRemainder.spent;
      if (input.lastFull.transactionCount >= 5) {
        out.push({
          id: 'projected-savings',
          tone: projected >= 0 ? 'positive' : 'negative',
          text:
            projected >= 0
              ? `If the rest of the month looks like last month, you'll save about ${fmt(projected)}.`
              : `If the rest of the month looks like last month, you'll end about ${fmt(projected)} short.`,
          weight: 90,
        });
      }
    }

    // 2. Total spending pace vs the same point last month.
    const spentChange = changeBp(thisMonth.summary.spent, lastSamePeriod.summary.spent);
    const spentDiff = thisMonth.summary.spent - lastSamePeriod.summary.spent;
    if (spentChange !== null && Math.abs(spentChange) >= 1500 && Math.abs(spentDiff) >= minDiff) {
      out.push({
        id: 'spending-pace',
        tone: spentDiff > 0 ? 'negative' : 'positive',
        text: `You've spent ${pct(spentChange)} ${spentDiff > 0 ? 'more' : 'less'} than at this point last month (${fmt(spentDiff)} ${spentDiff > 0 ? 'more' : 'less'}).`,
        weight: 80,
      });
    }

    // 3. The category that moved the most, in either direction.
    const last = new Map(lastSamePeriod.slices.map((s) => [s.categoryId, s.amount]));
    let best: { slice: CategorySlice; change: number; diff: number } | null = null;
    for (const slice of thisMonth.slices) {
      const before = last.get(slice.categoryId);
      if (before === undefined || before <= 0) continue; // "new" categories are not a trend
      const change = changeBp(slice.amount, before);
      const diff = slice.amount - before;
      if (change === null || Math.abs(change) < 1500 || Math.abs(diff) < minDiff) continue;
      if (!best || Math.abs(diff) > Math.abs(best.diff)) best = { slice, change, diff };
    }
    // Categories that vanished this month are good news worth a line too.
    for (const prior of lastSamePeriod.slices) {
      const now = thisMonth.slices.find((s) => s.categoryId === prior.categoryId);
      if (!now && prior.amount >= minDiff * 2 && (!best || prior.amount > Math.abs(best.diff))) {
        out.push({
          id: `category-gone-${prior.categoryId ?? 'none'}`,
          tone: 'positive',
          text: `No ${prior.name} spending yet this month, versus ${fmt(prior.amount)} at this point last month.`,
          categoryId: prior.categoryId,
          weight: 55,
        });
        break;
      }
    }
    if (best) {
      out.push({
        id: `category-trend-${best.slice.categoryId ?? 'none'}`,
        tone: best.diff > 0 ? 'negative' : 'positive',
        text: `You spent ${pct(best.change)} ${best.diff > 0 ? 'more' : 'less'} on ${best.slice.name} so far this month than at this point last month.`,
        categoryId: best.slice.categoryId,
        weight: 70,
      });
    }
  }

  // 4. Concentration: one category dominating the month so far (do not rely on caller ordering).
  const top = thisMonth.slices.reduce<CategorySlice | undefined>(
    (best, s) => (!best || s.amount > best.amount ? s : best),
    undefined,
  );
  if (
    top &&
    input.daysElapsed >= MIN_DAYS_FOR_CONCENTRATION &&
    thisMonth.slices.length >= 3 &&
    top.shareBp >= 3500 &&
    top.amount >= minDiff
  ) {
    out.push({
      id: `top-category-${top.categoryId ?? 'none'}`,
      tone: 'neutral',
      text: `${top.name} is ${pct(top.shareBp)} of your spending this month (${fmt(top.amount)}).`,
      categoryId: top.categoryId,
      weight: 40,
    });
  }

  // 5. What the subscriptions add up to: easy to forget, so worth saying out loud.
  const subs = input.subscriptions;
  if (subs && subs.count > 0 && subs.monthly >= minDiff) {
    out.push({
      id: 'subscriptions',
      tone: 'neutral',
      text: `Your ${subs.count === 1 ? 'subscription costs' : 'subscriptions cost'} about ${exact(subs.monthly)} a month (${exact(subs.yearly)} a year).`,
      weight: 35,
    });
  }

  return out
    .sort((a, b) => b.weight - a.weight)
    .slice(0, MAX_INSIGHTS)
    .map(({ weight: _weight, ...insight }) => insight);
}
