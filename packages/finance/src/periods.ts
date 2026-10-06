/**
 * Calendar-date arithmetic on "YYYY-MM-DD" strings. Everything is UTC-based and timezone-free, so a
 * date means the same day everywhere; the only timezone-aware step is deciding what "today" is for a
 * user (todayInZone). Pure and deterministic: "now" is always passed in.
 */

export type RangePreset = '7d' | '30d' | '3m' | '6m' | '1y';
export type BucketUnit = 'day' | 'week' | 'month';

export interface DateRange {
  /** Inclusive */
  from: string;
  /** Inclusive */
  to: string;
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseIso(iso: string): { y: number; m: number; d: number } {
  const match = ISO.exec(iso);
  if (!match) throw new Error(`Not a YYYY-MM-DD date: ${iso}`);
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    throw new Error(`That date does not exist: ${iso}`);
  }
  return { y, m, d };
}

export function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const utc = (iso: string): Date => {
  const { y, m, d } = parseIso(iso);
  return new Date(Date.UTC(y, m - 1, d));
};

export function addDays(iso: string, days: number): string {
  const date = utc(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return toIso(date);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((utc(to).getTime() - utc(from).getTime()) / 86_400_000);
}

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Adds calendar months, clamping the day (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(iso: string, months: number): string {
  const { y, m, d } = parseIso(iso);
  const index = y * 12 + (m - 1) + months;
  const ny = Math.floor(index / 12);
  const nm = (index % 12) + 1;
  const nd = Math.min(d, daysInMonth(ny, nm));
  return `${String(ny).padStart(4, '0')}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}

export const startOfMonth = (iso: string): string => `${iso.slice(0, 7)}-01`;

export function endOfMonth(iso: string): string {
  const { y, m } = parseIso(iso);
  return `${iso.slice(0, 7)}-${String(daysInMonth(y, m)).padStart(2, '0')}`;
}

/** Monday of the week containing `iso`. */
export function startOfWeek(iso: string): string {
  const weekday = utc(iso).getUTCDay(); // 0 = Sunday
  return addDays(iso, -((weekday + 6) % 7));
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The calendar date "now" falls on in a given IANA timezone. */
export function todayInZone(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${pad(Number(get('month')))}-${pad(Number(get('day')))}`;
}

/** 0-23 local hour in a timezone (for "Good morning"). */
export function hourInZone(now: Date, timeZone: string): number {
  const hour = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(now);
  return Number(hour) % 24;
}

export function greetingFor(hour: number): 'morning' | 'afternoon' | 'evening' {
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

/** Rolling windows that end today and include it: 7d is today plus the 6 days before. */
export function rangeForPreset(preset: RangePreset, today: string): DateRange {
  switch (preset) {
    case '7d':
      return { from: addDays(today, -6), to: today };
    case '30d':
      return { from: addDays(today, -29), to: today };
    case '3m':
      return { from: addDays(addMonths(today, -3), 1), to: today };
    case '6m':
      return { from: addDays(addMonths(today, -6), 1), to: today };
    case '1y':
      return { from: addDays(addMonths(today, -12), 1), to: today };
  }
}

/**
 * Daily bars only for about two weeks. Beyond that one payday or rent day towers over the rest and
 * flattens everything else, so we go weekly (to ~3 months) and monthly after that.
 */
export function bucketUnit(range: DateRange): BucketUnit {
  const days = daysBetween(range.from, range.to) + 1;
  if (days <= 14) return 'day';
  if (days <= 100) return 'week';
  return 'month';
}

export interface Bucket {
  /** First day the bucket covers within the range. */
  start: string;
  /** Last day the bucket covers within the range. */
  end: string;
}

/** Contiguous buckets covering the range exactly, first and last clipped to its edges. */
export function buildBuckets(range: DateRange, unit: BucketUnit): Bucket[] {
  const buckets: Bucket[] = [];
  let cursor = range.from;
  while (cursor <= range.to) {
    let end: string;
    if (unit === 'day') end = cursor;
    else if (unit === 'week') end = addDays(startOfWeek(cursor), 6);
    else end = endOfMonth(cursor);
    if (end > range.to) end = range.to;
    buckets.push({ start: cursor, end });
    cursor = addDays(end, 1);
  }
  return buckets;
}

export interface MonthWindows {
  /** 1st of this month through today. */
  current: DateRange;
  /** Same number of days at the start of last month (fair comparison early in a month). */
  previousSamePeriod: DateRange;
  /** All of last month. */
  previousFull: DateRange;
  daysElapsed: number;
  daysInMonth: number;
}

export function monthWindows(today: string): MonthWindows {
  const { y, m, d } = parseIso(today);
  const prevStart = startOfMonth(addMonths(startOfMonth(today), -1));
  const prevEnd = endOfMonth(prevStart);
  const prevDays = daysBetween(prevStart, prevEnd) + 1;
  return {
    current: { from: startOfMonth(today), to: today },
    previousSamePeriod: { from: prevStart, to: addDays(prevStart, Math.min(d, prevDays) - 1) },
    previousFull: { from: prevStart, to: prevEnd },
    daysElapsed: d,
    daysInMonth: daysInMonth(y, m),
  };
}

export const inRange = (date: string, range: DateRange): boolean =>
  date >= range.from && date <= range.to;

/** The range of equal length immediately before `range` (for "versus the previous period"). */
export function previousRange(range: DateRange): DateRange {
  const length = daysBetween(range.from, range.to) + 1;
  return { from: addDays(range.from, -length), to: addDays(range.from, -1) };
}
