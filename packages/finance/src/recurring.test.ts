import { describe, expect, it } from 'vitest';
import {
  describeCadence,
  dueDates,
  MAX_CATCH_UP,
  monthlyEquivalent,
  nextAfter,
  nextOnOrAfter,
  occurrenceAt,
  occurrencesBetween,
  yearlyEquivalent,
  type Recurrence,
} from './recurring';

const rule = (frequency: Recurrence['frequency'], anchor: string, interval = 1): Recurrence => ({
  frequency,
  interval,
  anchor,
});

describe('occurrences', () => {
  it('monthly on the 31st returns to the 31st after short months (never drifts to the 28th)', () => {
    const r = rule('monthly', '2026-01-31');
    expect([0, 1, 2, 3, 4, 5].map((k) => occurrenceAt(r, k))).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
    ]);
  });

  it('knows leap years: the 29th of February', () => {
    const monthly = rule('monthly', '2024-01-29');
    expect(occurrenceAt(monthly, 1)).toBe('2024-02-29');
    expect(occurrenceAt(rule('monthly', '2025-01-29'), 1)).toBe('2025-02-28');
    const yearly = rule('yearly', '2024-02-29');
    expect([1, 2, 3, 4].map((k) => occurrenceAt(yearly, k))).toEqual([
      '2025-02-28',
      '2026-02-28',
      '2027-02-28',
      '2028-02-29',
    ]);
  });

  it('weekly, every-other-week, daily and quarterly', () => {
    expect(occurrenceAt(rule('weekly', '2026-10-05'), 2)).toBe('2026-10-19');
    expect(occurrenceAt(rule('weekly', '2026-10-05', 2), 3)).toBe('2026-11-16');
    expect(occurrenceAt(rule('daily', '2026-12-30'), 3)).toBe('2027-01-02');
    expect(occurrenceAt(rule('daily', '2026-10-05', 10), 2)).toBe('2026-10-25');
    expect(occurrenceAt(rule('monthly', '2026-11-30', 3), 1)).toBe('2027-02-28');
  });

  it('crosses year boundaries', () => {
    const r = rule('monthly', '2026-12-15');
    expect(occurrenceAt(r, 1)).toBe('2027-01-15');
    expect(occurrenceAt(rule('yearly', '2026-12-31'), 1)).toBe('2027-12-31');
  });
});

describe('finding the next occurrence', () => {
  it('on or after a date; a date that is itself an occurrence is returned as is', () => {
    const r = rule('monthly', '2026-01-15');
    expect(nextOnOrAfter(r, '2026-10-05')).toBe('2026-10-15');
    expect(nextOnOrAfter(r, '2026-10-15')).toBe('2026-10-15');
    expect(nextOnOrAfter(r, '2026-10-16')).toBe('2026-11-15');
    expect(nextOnOrAfter(r, '2025-06-01')).toBe('2026-01-15'); // before the anchor: the anchor
  });

  it('strictly after a date', () => {
    const r = rule('weekly', '2026-10-05');
    expect(nextAfter(r, '2026-10-05')).toBe('2026-10-12');
    expect(nextAfter(r, '2026-10-06')).toBe('2026-10-12');
  });

  it('works far from the anchor, for every frequency, with intervals', () => {
    for (const r of [
      rule('daily', '2020-02-29', 3),
      rule('weekly', '2020-02-29', 2),
      rule('monthly', '2020-01-31', 5),
      rule('yearly', '2020-02-29', 2),
    ]) {
      for (const date of ['2026-10-05', '2024-02-29', '2031-03-01']) {
        const next = nextOnOrAfter(r, date);
        expect(next >= date).toBe(true);
        // and it really is the first one: the occurrence before it is earlier than `date`
        let k = 0;
        while (occurrenceAt(r, k) < next) k += 1;
        expect(k === 0 || occurrenceAt(r, k - 1) < date).toBe(true);
      }
    }
  });

  it('rejects nonsense intervals instead of looping forever', () => {
    expect(() => nextOnOrAfter(rule('daily', '2026-10-05', 0), '2026-10-06')).toThrow();
    expect(() => nextOnOrAfter(rule('daily', '2026-10-05', 1.5), '2026-10-06')).toThrow();
  });
});

describe('occurrencesBetween and dueDates', () => {
  it('lists occurrences in an inclusive window', () => {
    expect(occurrencesBetween(rule('weekly', '2026-10-05'), '2026-10-05', '2026-10-26')).toEqual([
      '2026-10-05',
      '2026-10-12',
      '2026-10-19',
      '2026-10-26',
    ]);
    expect(occurrencesBetween(rule('monthly', '2026-01-31'), '2026-02-01', '2026-04-30')).toEqual([
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
  });

  it('stops at the rule’s end date, inclusive', () => {
    const r = rule('monthly', '2026-01-15');
    expect(occurrencesBetween(r, '2026-01-01', '2026-12-31', { until: '2026-03-15' })).toEqual([
      '2026-01-15',
      '2026-02-15',
      '2026-03-15',
    ]);
    expect(occurrencesBetween(r, '2026-01-01', '2026-12-31', { until: '2026-03-14' })).toHaveLength(
      2,
    );
  });

  it('is empty when nothing falls in the window', () => {
    expect(occurrencesBetween(rule('monthly', '2026-01-15'), '2026-10-16', '2026-11-14')).toEqual(
      [],
    );
  });

  it('what is due is everything from the stored next date up to today', () => {
    const r = rule('monthly', '2026-07-12');
    expect(dueDates(r, '2026-08-12', '2026-10-15', null)).toEqual([
      '2026-08-12',
      '2026-09-12',
      '2026-10-12',
    ]);
    expect(dueDates(r, '2026-10-12', '2026-10-11', null)).toEqual([]); // not due yet
    expect(dueDates(r, '2026-10-12', '2026-10-12', null)).toEqual(['2026-10-12']); // due today
  });

  it('caps a very long catch-up so the ledger is never flooded', () => {
    const due = dueDates(rule('daily', '2020-01-01'), '2020-01-01', '2026-10-05', null);
    expect(due).toHaveLength(MAX_CATCH_UP);
    expect(due[0]).toBe('2020-01-01');
  });
});

describe('what a payment costs', () => {
  it('normalises to a month and a year', () => {
    expect(monthlyEquivalent(1599, 'monthly', 1)).toBe(1599);
    expect(yearlyEquivalent(3900, 'monthly', 1)).toBe(46800); // "approximately $468 a year"
    expect(monthlyEquivalent(12000, 'yearly', 1)).toBe(1000);
    expect(yearlyEquivalent(12000, 'yearly', 1)).toBe(12000);
    expect(monthlyEquivalent(1000, 'weekly', 1)).toBe(4333); // 52/12 weeks a month
    expect(yearlyEquivalent(1000, 'weekly', 1)).toBe(52000);
    expect(monthlyEquivalent(100, 'daily', 1)).toBe(3042); // 365/12 days a month
  });

  it('honours the interval', () => {
    expect(monthlyEquivalent(3000, 'monthly', 3)).toBe(1000); // quarterly
    expect(yearlyEquivalent(3000, 'monthly', 3)).toBe(12000);
    expect(monthlyEquivalent(2000, 'weekly', 2)).toBe(4333); // fortnightly
    expect(yearlyEquivalent(2000, 'weekly', 2)).toBe(52000);
    expect(yearlyEquivalent(50000, 'yearly', 2)).toBe(25000);
  });

  it('the four demo subscriptions add up to the $47 in the brief', () => {
    const subs = [999, 900, 1599, 1199];
    expect(subs.reduce((s, a) => s + monthlyEquivalent(a, 'monthly', 1), 0)).toBe(4697);
  });

  it('guards against overflow', () => {
    expect(() => monthlyEquivalent(Number.MAX_SAFE_INTEGER, 'daily', 1)).toThrow();
  });
});

describe('describeCadence', () => {
  it('reads naturally', () => {
    expect(describeCadence('monthly', 1)).toBe('Monthly');
    expect(describeCadence('weekly', 2)).toBe('Every 2 weeks');
    expect(describeCadence('monthly', 3)).toBe('Every 3 months');
    expect(describeCadence('yearly', 1)).toBe('Yearly');
    expect(describeCadence('daily', 10)).toBe('Every 10 days');
  });
});
