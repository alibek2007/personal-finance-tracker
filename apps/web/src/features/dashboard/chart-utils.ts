import { AXIS_INTERVALS, currencyExponent, niceDomain, type CurrencyCode } from '@pfm/finance';
import { format, parseISO } from 'date-fns';

/** Display-only conversion of minor units to a plain number for chart axes. Never used for arithmetic. */
export const toMajor = (minor: number, currency: CurrencyCode): number =>
  minor / 10 ** currencyExponent(currency);

export function compactMoney(minor: number, currency: CurrencyCode, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(toMajor(minor, currency));
}

export function bucketLabel(start: string, end: string, unit: 'day' | 'week' | 'month'): string {
  if (unit === 'month') return format(parseISO(start), 'MMM');
  return format(parseISO(start), 'MMM d');
}

export function bucketTitle(start: string, end: string, unit: 'day' | 'week' | 'month'): string {
  if (unit === 'day' || start === end) return format(parseISO(start), 'EEEE, MMM d');
  if (unit === 'month') return format(parseISO(start), 'MMMM yyyy');
  return `${format(parseISO(start), 'MMM d')} to ${format(parseISO(end), 'MMM d')}`;
}

export const reducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Categorical chart colours are theme tokens, so charts re-colour correctly in dark mode. */
/**
 * Y-axis props that put ticks on round numbers (see niceDomain). Spread onto <YAxis>.
 * `includeZero: false` is for balances that live far from zero.
 */
export const niceY = (includeZero = true) =>
  ({
    domain: ([min, max]: readonly [number, number]) => niceDomain(min, max, { includeZero }),
    tickCount: AXIS_INTERVALS + 1,
  }) as const;

export const sliceColor = (index: number): string => `var(--chart-${(index % 8) + 1})`;
