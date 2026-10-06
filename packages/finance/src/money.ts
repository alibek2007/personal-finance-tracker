import { CURRENCIES, currencyExponent, isCurrencyCode, type CurrencyCode } from './currency';

/**
 * Money is an integer count of minor units (cents) plus a currency.
 * No floating point is ever used for arithmetic; fractional factors go through
 * exact BigInt rational math with an explicit rounding mode.
 */
export interface Money {
  readonly minor: number;
  readonly currency: CurrencyCode;
}

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

export type RoundingMode = 'half-up' | 'half-even' | 'floor' | 'ceil' | 'trunc';

function assertSafe(minor: number, what: string): number {
  if (!Number.isSafeInteger(minor)) {
    throw new MoneyError(`${what} is not a safe integer amount of minor units: ${minor}`);
  }
  // Normalise -0 to 0 so equality and formatting are stable.
  return minor === 0 ? 0 : minor;
}

export function money(minor: number, currency: CurrencyCode): Money {
  if (!isCurrencyCode(currency)) throw new MoneyError(`Unsupported currency: ${currency}`);
  return { minor: assertSafe(minor, 'amount'), currency };
}

export const zero = (currency: CurrencyCode): Money => money(0, currency);

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new MoneyError(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.minor + b.minor, a.currency);
}

export function subtractMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.minor - b.minor, a.currency);
}

export function negateMoney(a: Money): Money {
  return money(-a.minor, a.currency);
}

export function absMoney(a: Money): Money {
  return money(Math.abs(a.minor), a.currency);
}

export function sumMoney(values: readonly Money[], currency: CurrencyCode): Money {
  let total = 0;
  for (const v of values) {
    if (v.currency !== currency) {
      throw new MoneyError(`Currency mismatch: ${v.currency} vs ${currency}`);
    }
    total = assertSafe(total + v.minor, 'running total');
  }
  return money(total, currency);
}

/** Returns -1, 0 or 1. */
export function compareMoney(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  return a.minor < b.minor ? -1 : a.minor > b.minor ? 1 : 0;
}

export const isZero = (a: Money): boolean => a.minor === 0;
export const isNegative = (a: Money): boolean => a.minor < 0;
export const isPositive = (a: Money): boolean => a.minor > 0;
export const maxMoney = (a: Money, b: Money): Money => (compareMoney(a, b) >= 0 ? a : b);
export const minMoney = (a: Money, b: Money): Money => (compareMoney(a, b) <= 0 ? a : b);

// ---------------------------------------------------------------- exact rationals

interface Rational {
  num: bigint;
  den: bigint;
}

function numberToPlainString(n: number): string {
  if (!Number.isFinite(n)) throw new MoneyError(`Invalid factor: ${n}`);
  const s = String(n);
  if (!/e/i.test(s)) return s;
  return n.toFixed(20).replace(/0+$/, '').replace(/\.$/, '');
}

/** Parses a decimal string/number such as "0.15", "-1.5", 12 into an exact rational. */
function toRational(factor: number | string): Rational {
  let text = typeof factor === 'number' ? numberToPlainString(factor) : factor.trim();
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(text)) {
    throw new MoneyError(`Invalid factor: ${String(factor)}`);
  }
  let negative = false;
  if (text.startsWith('-') || text.startsWith('+')) {
    negative = text.startsWith('-');
    text = text.slice(1);
  }
  const [intPart = '', fracPart = ''] = text.split('.');
  const num = BigInt((intPart || '0') + fracPart);
  const den = 10n ** BigInt(fracPart.length);
  return { num: negative ? -num : num, den };
}

function divideRounded(num: bigint, den: bigint, mode: RoundingMode): bigint {
  if (den < 0n) {
    num = -num;
    den = -den;
  }
  let q = num / den; // truncates toward zero
  const r = num % den;
  if (r === 0n) return q;
  const negative = num < 0n;
  const twice = (r < 0n ? -r : r) * 2n;
  switch (mode) {
    case 'trunc':
      break;
    case 'floor':
      if (negative) q -= 1n;
      break;
    case 'ceil':
      if (!negative) q += 1n;
      break;
    case 'half-up': // ties away from zero
      if (twice >= den) q += negative ? -1n : 1n;
      break;
    case 'half-even':
      if (twice > den || (twice === den && q % 2n !== 0n)) q += negative ? -1n : 1n;
      break;
  }
  return q;
}

function toSafeNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new MoneyError('Result exceeds the safe integer range');
  }
  return Number(value);
}

/** Multiplies money by an exact decimal factor (e.g. "0.15" for 15%). */
export function multiplyMoney(
  a: Money,
  factor: number | string,
  mode: RoundingMode = 'half-up',
): Money {
  const { num, den } = toRational(factor);
  return money(toSafeNumber(divideRounded(BigInt(a.minor) * num, den, mode)), a.currency);
}

/** a * numerator / denominator with exact integer math (e.g. proration by days). */
export function scaleMoney(
  a: Money,
  numerator: number,
  denominator: number,
  mode: RoundingMode = 'half-up',
): Money {
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator) || denominator === 0) {
    throw new MoneyError(
      'scaleMoney needs an integer numerator and a non-zero integer denominator',
    );
  }
  return money(
    toSafeNumber(divideRounded(BigInt(a.minor) * BigInt(numerator), BigInt(denominator), mode)),
    a.currency,
  );
}

/** Ratio a/b in basis points (1/100 of a percent), rounded half-up. b must be non-zero. */
export function ratioBasisPoints(a: Money, b: Money): number {
  assertSameCurrency(a, b);
  if (b.minor === 0) throw new MoneyError('Cannot compute a ratio against zero');
  return toSafeNumber(divideRounded(BigInt(a.minor) * 10000n, BigInt(b.minor), 'half-up'));
}

/** Splits money into `parts` shares that always sum exactly to the original (remainder spread one minor unit at a time). */
export function allocateMoney(a: Money, parts: number): Money[] {
  if (!Number.isInteger(parts) || parts < 1) {
    throw new MoneyError('parts must be a positive integer');
  }
  const sign = a.minor < 0 ? -1 : 1;
  const abs = Math.abs(a.minor);
  const base = Math.floor(abs / parts);
  const remainder = abs - base * parts;
  return Array.from({ length: parts }, (_, i) =>
    money(sign * (base + (i < remainder ? 1 : 0)), a.currency),
  );
}

// ---------------------------------------------------------------- parse / format

/** Converts user input like "1,234.56" or "19.9" into exact minor units. Rejects excess precision. */
export function parseMoney(input: string, currency: CurrencyCode): Money {
  const exp = currencyExponent(currency);
  let text = input.trim().replace(/\s/g, '');
  for (const sym of [CURRENCIES[currency].symbol, currency]) text = text.split(sym).join('');
  let negative = false;
  if (text.startsWith('-') || text.startsWith('−')) {
    negative = true;
    text = text.slice(1);
  } else if (text.startsWith('(') && text.endsWith(')')) {
    negative = true;
    text = text.slice(1, -1);
  }
  text = text.replace(/,/g, '');
  if (!/^(\d+\.?\d*|\.\d+)$/.test(text))
    throw new MoneyError(`Cannot read "${input}" as an amount`);
  const [intPart = '', fracPart = ''] = text.split('.');
  if (fracPart.length > exp) {
    throw new MoneyError(`${currency} amounts have at most ${exp} decimal places`);
  }
  const value = toSafeNumber(BigInt((intPart || '0') + fracPart.padEnd(exp, '0')));
  return money(negative ? -value : value, currency);
}

export interface FormatMoneyOptions {
  locale?: string;
  /** 'always' prints + for positive amounts; 'never' hides the sign (use with a separate glyph). */
  signDisplay?: 'auto' | 'always' | 'never';
  /** Drop the fraction digits (e.g. "$12,450"). */
  compactFraction?: boolean;
}

/** Display-only: the single place a minor-unit amount is converted to a decimal for rendering. */
export function formatMoney(a: Money, options: FormatMoneyOptions = {}): string {
  const { locale = 'en-US', signDisplay = 'auto', compactFraction = false } = options;
  const exp = currencyExponent(a.currency);
  const digits = compactFraction ? 0 : exp;
  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: a.currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    signDisplay: signDisplay === 'always' ? 'exceptZero' : signDisplay,
  });
  const value = compactFraction ? Math.trunc(a.minor / 10 ** exp) : a.minor / 10 ** exp;
  return formatter.format(value).replace('-', '−');
}

/** Decimal string for CSV / exports, e.g. 1999 USD gives "19.99". Exact (no floats). */
export function toDecimalString(a: Money): string {
  const exp = currencyExponent(a.currency);
  const abs = String(Math.abs(a.minor)).padStart(exp + 1, '0');
  const body = exp === 0 ? abs : `${abs.slice(0, -exp)}.${abs.slice(-exp)}`;
  return a.minor < 0 ? `-${body}` : body;
}
