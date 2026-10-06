import type { CurrencyCode } from './currency';
import { MoneyError } from './money';
import {
  addDays,
  addMonths,
  endOfMonth,
  inRange,
  startOfMonth,
  type Bucket,
  type DateRange,
} from './periods';

/** The minimal slice of a transaction that reports need. */
export interface ReportTx {
  type: 'income' | 'expense' | 'transfer';
  amount: number;
  currency: CurrencyCode;
  /** YYYY-MM-DD */
  date: string;
  categoryId: string | null;
  isRefund: boolean;
}

export interface CategoryMeta {
  id: string;
  name: string;
  color: string;
  parentId: string | null;
}

const safe = (n: number): number => {
  if (!Number.isSafeInteger(n)) throw new MoneyError('Report total exceeds the safe integer range');
  return n;
};

/**
 * Only transactions in the report currency count; others are reported as excluded so a total is never
 * silently wrong. Transfers are never income or expense.
 */
export function inCurrency(txs: readonly ReportTx[], currency: CurrencyCode) {
  const counted: ReportTx[] = [];
  const excludedCurrencies = new Set<CurrencyCode>();
  for (const tx of txs) {
    if (tx.type === 'transfer') continue;
    if (tx.currency === currency) counted.push(tx);
    else excludedCurrencies.add(tx.currency);
  }
  return { counted, excludedCurrencies: [...excludedCurrencies].sort() };
}

export interface Summary {
  income: number;
  /** Expenses minus refunds: what you really spent. */
  spent: number;
  refunds: number;
  /** income - spent */
  saved: number;
  /** saved / income in basis points; null when there was no income to compare against. */
  savingsRateBp: number | null;
  transactionCount: number;
}

export function summarize(txs: readonly ReportTx[], range: DateRange): Summary {
  let income = 0;
  let expenses = 0;
  let refunds = 0;
  let count = 0;
  for (const tx of txs) {
    if (tx.type === 'transfer' || !inRange(tx.date, range)) continue;
    count += 1;
    if (tx.type === 'expense') expenses += tx.amount;
    else if (tx.isRefund) refunds += tx.amount;
    else income += tx.amount;
  }
  const spent = safe(expenses - refunds);
  const saved = safe(income - spent);
  return {
    income: safe(income),
    spent,
    refunds: safe(refunds),
    saved,
    savingsRateBp: income > 0 ? Math.round((saved * 10000) / income) : null,
    transactionCount: count,
  };
}

export interface CashFlowPoint extends Bucket {
  income: number;
  expenses: number;
  net: number;
}

/** One point per bucket, zero-filled so the chart has no holes. */
export function cashFlow(txs: readonly ReportTx[], buckets: readonly Bucket[]): CashFlowPoint[] {
  const points: CashFlowPoint[] = buckets.map((b) => ({ ...b, income: 0, expenses: 0, net: 0 }));
  for (const tx of txs) {
    if (tx.type === 'transfer') continue;
    // Buckets are sorted and contiguous; binary search keeps this O(n log b).
    let lo = 0;
    let hi = points.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const p = points[mid]!;
      if (tx.date < p.start) hi = mid - 1;
      else if (tx.date > p.end) lo = mid + 1;
      else {
        found = mid;
        break;
      }
    }
    if (found < 0) continue;
    const point = points[found]!;
    if (tx.type === 'expense') point.expenses += tx.amount;
    else if (tx.isRefund) point.expenses -= tx.amount;
    else point.income += tx.amount;
  }
  for (const p of points) {
    safe(p.income);
    safe(p.expenses);
    p.net = safe(p.income - p.expenses);
  }
  return points;
}

export interface CategorySlice {
  /** null for transactions with no category. */
  categoryId: string | null;
  name: string;
  color: string;
  /** Net spend (refunds subtracted). */
  amount: number;
  /** Share of total positive spend, in basis points. */
  shareBp: number;
  count: number;
  children: { categoryId: string | null; name: string; amount: number; count: number }[];
}

export const UNCATEGORISED = { name: 'Uncategorised', color: '#8a8f97' } as const;

/**
 * Spending grouped by top-level category (subcategories roll up and are listed as children).
 * Refunds reduce the category they were returned to. Slices at or below zero are dropped.
 */
export function categoryBreakdown(
  txs: readonly ReportTx[],
  categories: readonly CategoryMeta[],
): { slices: CategorySlice[]; total: number } {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const topOf = (id: string | null): string | null => {
    if (!id) return null;
    const c = byId.get(id);
    return c?.parentId ?? c?.id ?? null;
  };
  const groups = new Map<
    string | null,
    {
      amount: number;
      count: number;
      children: Map<string | null, { amount: number; count: number }>;
    }
  >();

  for (const tx of txs) {
    if (tx.type === 'transfer') continue;
    // Only expenses and refunds describe spending; ordinary income is not a "spending category".
    if (tx.type === 'income' && !tx.isRefund) continue;
    const signed = tx.type === 'expense' ? tx.amount : -tx.amount;
    const top = topOf(tx.categoryId);
    const group = groups.get(top) ?? { amount: 0, count: 0, children: new Map() };
    group.amount += signed;
    group.count += 1;
    const child = group.children.get(tx.categoryId) ?? { amount: 0, count: 0 };
    child.amount += signed;
    child.count += 1;
    group.children.set(tx.categoryId, child);
    groups.set(top, group);
  }

  const positive = [...groups.entries()].filter(([, g]) => g.amount > 0);
  const total = safe(positive.reduce((sum, [, g]) => sum + g.amount, 0));
  const slices: CategorySlice[] = positive
    .map(([id, g]) => {
      const meta = id ? byId.get(id) : undefined;
      return {
        categoryId: id,
        name: meta?.name ?? UNCATEGORISED.name,
        color: meta?.color ?? UNCATEGORISED.color,
        amount: g.amount,
        shareBp: total > 0 ? Math.round((g.amount * 10000) / total) : 0,
        count: g.count,
        children: [...g.children.entries()]
          .filter(([, c]) => c.amount > 0)
          .map(([cid, c]) => ({
            categoryId: cid,
            name: (cid ? byId.get(cid)?.name : undefined) ?? UNCATEGORISED.name,
            amount: c.amount,
            count: c.count,
          }))
          .sort((a, b) => b.amount - a.amount),
      };
    })
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
  return { slices, total };
}

/** (current - previous) / previous in basis points; null when there is nothing to compare to. */
export function changeBp(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) * 10000) / Math.abs(previous));
}

// ------------------------------------------------------------------ spending over time

export interface TrendSeries {
  /** Top-level category id, '__none' for uncategorised, or 'other' for everything smaller. */
  key: string;
  name: string;
  color: string;
}

export interface TrendPoint extends Bucket {
  total: number;
  /** Net spend per series key (refunds subtract). */
  values: Record<string, number>;
}

export const OTHER_KEY = 'other';
export const NONE_KEY = '__none';

/**
 * Spending per bucket split by the biggest top-level categories (by total over the whole range),
 * with everything else grouped as "Everything else". Totals always equal the plain cash-flow expenses.
 */
export function spendingTrend(
  txs: readonly ReportTx[],
  categories: readonly CategoryMeta[],
  buckets: readonly Bucket[],
  topN = 5,
): { series: TrendSeries[]; points: TrendPoint[] } {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const keyOf = (id: string | null): string => {
    if (!id) return NONE_KEY;
    const c = byId.get(id);
    return c ? (c.parentId ?? c.id) : NONE_KEY;
  };
  const spendTxs = txs.filter((t) => t.type === 'expense' || (t.type === 'income' && t.isRefund));
  const totals = new Map<string, number>();
  for (const t of spendTxs) {
    const key = keyOf(t.categoryId);
    totals.set(key, (totals.get(key) ?? 0) + (t.type === 'expense' ? t.amount : -t.amount));
  }
  const ranked = [...totals.entries()]
    .filter(([, amount]) => amount > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => key);
  const top = new Set(ranked.slice(0, topN));
  const needsOther =
    ranked.length > topN || [...totals.entries()].some(([k, v]) => v <= 0 && !top.has(k));

  const series: TrendSeries[] = ranked.slice(0, topN).map((key) => {
    const meta = byId.get(key);
    return {
      key,
      name: meta?.name ?? UNCATEGORISED.name,
      color: meta?.color ?? UNCATEGORISED.color,
    };
  });
  if (needsOther) series.push({ key: OTHER_KEY, name: 'Everything else', color: '#8a8f97' });

  const points: TrendPoint[] = buckets.map((b) => ({
    ...b,
    total: 0,
    values: Object.fromEntries(series.map((s) => [s.key, 0])),
  }));
  for (const t of spendTxs) {
    const point = points.find((p) => t.date >= p.start && t.date <= p.end);
    if (!point) continue;
    const key = keyOf(t.categoryId);
    const bucketKey = top.has(key) ? key : OTHER_KEY;
    const signed = t.type === 'expense' ? t.amount : -t.amount;
    point.values[bucketKey] = (point.values[bucketKey] ?? 0) + signed;
    point.total += signed;
  }
  for (const p of points) safe(p.total);
  return { series, points };
}

// ------------------------------------------------------------------ month by month

export interface MonthRow {
  /** YYYY-MM */
  month: string;
  from: string;
  to: string;
  /** The current month is only partly over. */
  partial: boolean;
  income: number;
  spent: number;
  saved: number;
  savingsRateBp: number | null;
  /** Change versus the previous month (for the current month: the same number of days of it). */
  incomeChangeBp: number | null;
  spentChangeBp: number | null;
  savedChangeBp: number | null;
}

/**
 * The last `months` calendar months, oldest first. `txs` must reach back one month further than the
 * first row so its change can be computed. A partial current month is compared like-for-like.
 */
export function monthlyComparison(
  txs: readonly ReportTx[],
  today: string,
  months: number,
): MonthRow[] {
  const rows: MonthRow[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const start = addMonths(startOfMonth(today), -i);
    const fullEnd = endOfMonth(start);
    const partial = fullEnd > today;
    const to = partial ? today : fullEnd;
    const current = summarize(txs, { from: start, to });

    const prevStart = addMonths(start, -1);
    const prevFullEnd = endOfMonth(prevStart);
    const length = partial ? Number(today.slice(8, 10)) : Number(fullEnd.slice(8, 10));
    const prevTo = partial
      ? addDays(prevStart, Math.min(length, Number(prevFullEnd.slice(8, 10))) - 1)
      : prevFullEnd;
    const previous = summarize(txs, { from: prevStart, to: prevTo });

    rows.push({
      month: start.slice(0, 7),
      from: start,
      to,
      partial,
      income: current.income,
      spent: current.spent,
      saved: current.saved,
      savingsRateBp: current.savingsRateBp,
      incomeChangeBp: changeBp(current.income, previous.income),
      spentChangeBp: changeBp(current.spent, previous.spent),
      savedChangeBp: changeBp(current.saved, previous.saved),
    });
  }
  return rows;
}

// ------------------------------------------------------------------ cumulative amounts

/** Running total of dated amounts, sampled at each date (inclusive). `dates` must be ascending. */
export function cumulativeSeries(
  items: readonly { date: string; amount: number }[],
  dates: readonly string[],
): number[] {
  const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date));
  const out: number[] = [];
  let i = 0;
  let running = 0;
  for (const d of dates) {
    while (i < sorted.length && sorted[i]!.date <= d) {
      running += sorted[i]!.amount;
      i += 1;
    }
    out.push(safe(running));
  }
  return out;
}
