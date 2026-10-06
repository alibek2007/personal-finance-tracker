import { describe, expect, it } from 'vitest';
import { AXIS_INTERVALS, niceDomain } from './axis';

const ticks = ([lo, hi]: [number, number]) =>
  Array.from({ length: AXIS_INTERVALS + 1 }, (_, i) =>
    Number((lo + ((hi - lo) / AXIS_INTERVALS) * i).toPrecision(12)),
  );

describe('niceDomain', () => {
  it('lands on round numbers instead of 950 / 1,900', () => {
    expect(niceDomain(0, 1900)).toEqual([0, 2000]);
    expect(ticks(niceDomain(0, 1900))).toEqual([0, 500, 1000, 1500, 2000]);
    expect(ticks(niceDomain(0, 3700))).toEqual([0, 1000, 2000, 3000, 4000]);
    expect(ticks(niceDomain(0, 4811))).toEqual([0, 1500, 3000, 4500, 6000]);
  });

  it('always covers the data and keeps four equal steps', () => {
    for (const max of [1, 7, 99, 100, 101, 487, 1234, 4811, 9999, 12_345, 250_000, 1_234_567]) {
      const [lo, hi] = niceDomain(0, max);
      expect(lo).toBe(0);
      expect(hi).toBeGreaterThanOrEqual(max);
      // Not wastefully large: the top tick is within one step of the data.
      expect(hi).toBeLessThan(max * 2.1 + 1);
      const step = (hi - lo) / AXIS_INTERVALS;
      const mantissa = step / 10 ** Math.floor(Math.log10(step));
      expect([1, 1.5, 2, 2.5, 3, 4, 5, 10]).toContain(Number(mantissa.toPrecision(6)));
    }
  });

  it('includes zero for bars and areas, even for all-positive or all-negative data', () => {
    expect(niceDomain(300, 900)[0]).toBe(0);
    expect(niceDomain(-900, -300)[1]).toBe(0);
  });

  it('handles negatives that span zero', () => {
    const [lo, hi] = niceDomain(-1200, 3100);
    expect(lo).toBeLessThanOrEqual(-1200);
    expect(hi).toBeGreaterThanOrEqual(3100);
    expect(ticks([lo, hi])).toContain(0);
  });

  it('can leave zero out for balances that live far from it', () => {
    const [lo, hi] = niceDomain(18_200, 19_700, { includeZero: false });
    expect(lo).toBeGreaterThan(10_000);
    expect(hi).toBeGreaterThanOrEqual(19_700);
    expect(lo).toBeLessThanOrEqual(18_200);
  });

  it('copes with empty, flat and non-finite data', () => {
    expect(niceDomain(0, 0)).toEqual([0, 1]);
    const flat = niceDomain(500, 500, { includeZero: false });
    expect(flat[0]).toBeLessThan(500);
    expect(flat[1]).toBeGreaterThan(500);
    expect(niceDomain(NaN, 5)).toEqual([0, 1]);
  });

  it('works for small decimals without floating-point dust', () => {
    const [lo, hi] = niceDomain(0, 0.9);
    expect([lo, hi]).toEqual([0, 1]);
    expect(ticks([lo, hi])).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });
});
