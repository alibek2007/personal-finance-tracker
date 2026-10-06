import { addDays, addMonths, daysBetween, parseIso } from './periods';

export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface Recurrence {
  frequency: RecurrenceFrequency;
  /** Every N days / weeks / months / years. */
  interval: number;
  /**
   * The date of the first occurrence. Monthly and yearly occurrences are always measured from it,
   * so a payment on the 31st returns to the 31st after a short month (Jan 31, Feb 28, Mar 31...).
   */
  anchor: string;
}

function assertValid(r: Recurrence): void {
  if (!Number.isInteger(r.interval) || r.interval < 1)
    throw new Error('A recurrence interval must be a whole number of at least 1');
  parseIso(r.anchor);
}

/** The k-th occurrence (k = 0 is the anchor itself). */
export function occurrenceAt(r: Recurrence, k: number): string {
  switch (r.frequency) {
    case 'daily':
      return addDays(r.anchor, k * r.interval);
    case 'weekly':
      return addDays(r.anchor, 7 * k * r.interval);
    case 'monthly':
      return addMonths(r.anchor, k * r.interval);
    case 'yearly':
      return addMonths(r.anchor, 12 * k * r.interval);
  }
}

/** Rough index of the first occurrence on or after `date`, refined by stepping. */
function indexOnOrAfter(r: Recurrence, date: string): number {
  if (date <= r.anchor) return 0;
  const days = daysBetween(r.anchor, date);
  const approx =
    r.frequency === 'daily'
      ? days / r.interval
      : r.frequency === 'weekly'
        ? days / (7 * r.interval)
        : r.frequency === 'monthly'
          ? days / (30.4375 * r.interval)
          : days / (365.25 * r.interval);
  let k = Math.max(0, Math.floor(approx) - 1);
  while (occurrenceAt(r, k) < date) k += 1;
  while (k > 0 && occurrenceAt(r, k - 1) >= date) k -= 1;
  return k;
}

/** The first occurrence on or after `date`. */
export function nextOnOrAfter(r: Recurrence, date: string): string {
  assertValid(r);
  return occurrenceAt(r, indexOnOrAfter(r, date));
}

/** The first occurrence strictly after `date`. */
export function nextAfter(r: Recurrence, date: string): string {
  return nextOnOrAfter(r, addDays(date, 1));
}

/** All occurrences within [from, to], not past `until` (inclusive), at most `limit`. */
export function occurrencesBetween(
  r: Recurrence,
  from: string,
  to: string,
  options: { until?: string | null; limit?: number } = {},
): string[] {
  assertValid(r);
  const limit = options.limit ?? 400;
  const out: string[] = [];
  let k = indexOnOrAfter(r, from);
  for (;;) {
    const d = occurrenceAt(r, k);
    if (d > to || (options.until != null && d > options.until) || out.length >= limit) break;
    out.push(d);
    k += 1;
  }
  return out;
}

/** Most payments created in one catch-up, so a long-neglected rule cannot flood the ledger. */
export const MAX_CATCH_UP = 60;

/** Occurrences that have come due: from the stored next date up to `today`, within the rule's end date. */
export function dueDates(
  r: Recurrence,
  nextOccurrence: string,
  today: string,
  until: string | null,
): string[] {
  return occurrencesBetween(r, nextOccurrence, today, { until, limit: MAX_CATCH_UP });
}

const safeInt = (n: number) => {
  if (!Number.isSafeInteger(n)) throw new Error('Recurring total exceeds the safe integer range');
  return n;
};

/** What this payment costs per month on average (minor units). */
export function monthlyEquivalent(
  amount: number,
  frequency: RecurrenceFrequency,
  interval: number,
): number {
  switch (frequency) {
    case 'daily':
      return safeInt(Math.round((amount * 365) / (12 * interval)));
    case 'weekly':
      return safeInt(Math.round((amount * 52) / (12 * interval)));
    case 'monthly':
      return safeInt(Math.round(amount / interval));
    case 'yearly':
      return safeInt(Math.round(amount / (12 * interval)));
  }
}

/** What this payment costs per year (minor units), computed directly rather than as 12x the monthly figure. */
export function yearlyEquivalent(
  amount: number,
  frequency: RecurrenceFrequency,
  interval: number,
): number {
  switch (frequency) {
    case 'daily':
      return safeInt(Math.round((amount * 365) / interval));
    case 'weekly':
      return safeInt(Math.round((amount * 52) / interval));
    case 'monthly':
      return safeInt(Math.round((amount * 12) / interval));
    case 'yearly':
      return safeInt(Math.round(amount / interval));
  }
}

const UNIT: Record<RecurrenceFrequency, [string, string, string]> = {
  daily: ['Daily', 'day', 'days'],
  weekly: ['Weekly', 'week', 'weeks'],
  monthly: ['Monthly', 'month', 'months'],
  yearly: ['Yearly', 'year', 'years'],
};

/** "Monthly", "Every 2 weeks". */
export function describeCadence(frequency: RecurrenceFrequency, interval: number): string {
  const [single, , plural] = UNIT[frequency];
  return interval === 1 ? single : `Every ${interval} ${plural}`;
}
