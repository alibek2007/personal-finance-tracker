import { describe, expect, it } from 'vitest';
import {
  absMoney,
  addMoney,
  allocateMoney,
  compareMoney,
  formatMoney,
  money,
  MoneyError,
  multiplyMoney,
  negateMoney,
  parseMoney,
  ratioBasisPoints,
  scaleMoney,
  subtractMoney,
  sumMoney,
  toDecimalString,
  zero,
} from './money';

const usd = (minor: number) => money(minor, 'USD');

describe('construction', () => {
  it('rejects non-integers and unsafe integers', () => {
    expect(() => usd(19.99)).toThrow(MoneyError);
    expect(() => usd(Number.MAX_SAFE_INTEGER + 2)).toThrow(MoneyError);
    expect(() => usd(NaN)).toThrow(MoneyError);
  });

  it('normalises negative zero', () => {
    expect(Object.is(usd(-0).minor, 0)).toBe(true);
    expect(Object.is(multiplyMoney(usd(-1), '0.1', 'half-up').minor, 0)).toBe(true);
  });

  it('rejects unsupported currencies', () => {
    expect(() => money(1, 'XXX' as never)).toThrow(MoneyError);
  });
});

describe('arithmetic', () => {
  it('adds and subtracts exactly where floats fail (0.1 + 0.2)', () => {
    expect(addMoney(usd(10), usd(20)).minor).toBe(30);
    expect(subtractMoney(usd(30), usd(10)).minor).toBe(20);
  });

  it('refuses to mix currencies', () => {
    expect(() => addMoney(usd(1), money(1, 'EUR'))).toThrow(/mismatch/);
    expect(() => compareMoney(usd(1), money(1, 'KZT'))).toThrow(/mismatch/);
    expect(() => sumMoney([usd(1), money(1, 'EUR')], 'USD')).toThrow(/mismatch/);
  });

  it('sums an empty list to zero', () => {
    expect(sumMoney([], 'USD')).toEqual(zero('USD'));
  });

  it('supports negative balances (credit card debt)', () => {
    const checking = usd(432000);
    const card = usd(-82000);
    expect(addMoney(checking, card).minor).toBe(350000);
    expect(absMoney(card).minor).toBe(82000);
    expect(negateMoney(card).minor).toBe(82000);
  });

  it('compares', () => {
    expect(compareMoney(usd(1), usd(2))).toBe(-1);
    expect(compareMoney(usd(2), usd(2))).toBe(0);
    expect(compareMoney(usd(3), usd(2))).toBe(1);
  });
});

describe('multiplyMoney rounding', () => {
  it('computes percentages exactly', () => {
    expect(multiplyMoney(usd(1999), '0.15').minor).toBe(300); // 299.85 -> 300
    expect(multiplyMoney(usd(10000), 0.07).minor).toBe(700);
  });

  it('handles ties per mode', () => {
    expect(multiplyMoney(usd(5), '0.5', 'half-up').minor).toBe(3); // 2.5
    expect(multiplyMoney(usd(5), '0.5', 'half-even').minor).toBe(2);
    expect(multiplyMoney(usd(7), '0.5', 'half-even').minor).toBe(4); // 3.5
    expect(multiplyMoney(usd(-5), '0.5', 'half-up').minor).toBe(-3); // away from zero
    expect(multiplyMoney(usd(5), '0.5', 'floor').minor).toBe(2);
    expect(multiplyMoney(usd(-5), '0.5', 'floor').minor).toBe(-3);
    expect(multiplyMoney(usd(5), '0.5', 'ceil').minor).toBe(3);
    expect(multiplyMoney(usd(-5), '0.5', 'ceil').minor).toBe(-2);
    expect(multiplyMoney(usd(-5), '0.5', 'trunc').minor).toBe(-2);
  });

  it('accepts small numbers that stringify in exponent form', () => {
    expect(multiplyMoney(usd(1_000_000_000), 1e-7).minor).toBe(100);
  });

  it('rejects garbage factors', () => {
    expect(() => multiplyMoney(usd(1), 'abc')).toThrow(MoneyError);
    expect(() => multiplyMoney(usd(1), Infinity)).toThrow(MoneyError);
  });

  it('detects overflow instead of silently losing precision', () => {
    expect(() => multiplyMoney(usd(Number.MAX_SAFE_INTEGER), 2)).toThrow(/safe integer/);
  });
});

describe('scaleMoney / ratio / allocate', () => {
  it('prorates by integer ratio', () => {
    expect(scaleMoney(usd(3100), 10, 31).minor).toBe(1000);
    expect(scaleMoney(usd(1000), 1, 3).minor).toBe(333);
    expect(() => scaleMoney(usd(1), 1, 0)).toThrow(MoneyError);
  });

  it('computes ratio in basis points', () => {
    expect(ratioBasisPoints(usd(32000), usd(50000))).toBe(6400);
    expect(ratioBasisPoints(usd(1), usd(3))).toBe(3333);
    expect(() => ratioBasisPoints(usd(1), usd(0))).toThrow(MoneyError);
  });

  it('allocates without losing a cent', () => {
    for (const total of [100, 101, 1, 0, -101, 999_999]) {
      for (const parts of [1, 2, 3, 7]) {
        const shares = allocateMoney(usd(total), parts);
        expect(shares).toHaveLength(parts);
        expect(sumMoney(shares, 'USD').minor).toBe(total);
        const minors = shares.map((s) => Math.abs(s.minor));
        expect(Math.max(...minors) - Math.min(...minors)).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('parseMoney', () => {
  it('parses common formats exactly', () => {
    expect(parseMoney('19.99', 'USD').minor).toBe(1999);
    expect(parseMoney('$1,234.5', 'USD').minor).toBe(123450);
    expect(parseMoney('  42 ', 'USD').minor).toBe(4200);
    expect(parseMoney('.5', 'USD').minor).toBe(50);
    expect(parseMoney('-7.25', 'USD').minor).toBe(-725);
    expect(parseMoney('−7.25', 'USD').minor).toBe(-725);
    expect(parseMoney('(7.25)', 'USD').minor).toBe(-725);
    expect(parseMoney('1 500', 'KZT').minor).toBe(150000);
    expect(parseMoney('1500', 'JPY').minor).toBe(1500);
  });

  it('rejects excess precision and junk', () => {
    expect(() => parseMoney('1.999', 'USD')).toThrow(/decimal places/);
    expect(() => parseMoney('1.5', 'JPY')).toThrow(/decimal places/);
    expect(() => parseMoney('abc', 'USD')).toThrow(MoneyError);
    expect(() => parseMoney('', 'USD')).toThrow(MoneyError);
    expect(() => parseMoney('1.2.3', 'USD')).toThrow(MoneyError);
  });

  it('round-trips with toDecimalString', () => {
    for (const minor of [0, 1, 99, 100, 1999, -1999, 123456789]) {
      expect(parseMoney(toDecimalString(usd(minor)), 'USD').minor).toBe(minor);
    }
  });
});

describe('formatting', () => {
  it('formats with currency symbol and a true minus sign', () => {
    expect(formatMoney(usd(1245000))).toBe('$12,450.00');
    expect(formatMoney(usd(-82000))).toBe('−$820.00');
    expect(formatMoney(usd(480000), { signDisplay: 'always' })).toBe('+$4,800.00');
    expect(formatMoney(usd(1245099), { compactFraction: true })).toBe('$12,450');
    expect(formatMoney(money(1500, 'JPY'))).toBe('¥1,500');
  });

  it('toDecimalString is exact', () => {
    expect(toDecimalString(usd(5))).toBe('0.05');
    expect(toDecimalString(usd(-5))).toBe('-0.05');
    expect(toDecimalString(money(1500, 'JPY'))).toBe('1500');
  });
});
