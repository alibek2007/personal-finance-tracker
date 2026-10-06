import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  bucketUnit,
  buildBuckets,
  daysBetween,
  daysInMonth,
  endOfMonth,
  greetingFor,
  hourInZone,
  isLeapYear,
  monthWindows,
  parseIso,
  rangeForPreset,
  startOfWeek,
  todayInZone,
} from './periods';

describe('date arithmetic', () => {
  it('rejects impossible dates instead of rolling over', () => {
    expect(() => parseIso('2026-02-30')).toThrow(/does not exist/);
    expect(() => parseIso('2025-02-29')).toThrow();
    expect(() => parseIso('nope')).toThrow();
    expect(parseIso('2024-02-29')).toEqual({ y: 2024, m: 2, d: 29 });
  });

  it('knows leap years (including the century rules)', () => {
    expect([2024, 2000, 2026, 1900, 2100].map(isLeapYear)).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
    expect(addDays('2026-10-05', -6)).toBe('2026-09-29');
  });

  it('adds months by clamping the day (never skipping into the next month)', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
    expect(addMonths('2026-01-15', -2)).toBe('2025-11-15');
  });

  it('counts days between dates (DST cannot skew it)', () => {
    expect(daysBetween('2026-03-01', '2026-03-31')).toBe(30);
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2); // US DST starts 2026-03-08
    expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2);
  });

  it('finds week starts (Monday) and month ends', () => {
    expect(startOfWeek('2026-10-05')).toBe('2026-10-05'); // a Monday
    expect(startOfWeek('2026-10-11')).toBe('2026-10-05'); // Sunday belongs to the week before
    expect(startOfWeek('2026-10-04')).toBe('2026-09-28');
    expect(endOfMonth('2024-02-10')).toBe('2024-02-29');
  });
});

describe('timezones decide what "today" is', () => {
  const instant = new Date('2026-10-05T23:30:00Z');

  it('the same instant is different dates in different places', () => {
    expect(todayInZone(instant, 'UTC')).toBe('2026-10-05');
    expect(todayInZone(instant, 'Asia/Almaty')).toBe('2026-10-06'); // UTC+5
    expect(todayInZone(instant, 'America/Los_Angeles')).toBe('2026-10-05');
    expect(todayInZone(new Date('2026-10-05T03:00:00Z'), 'America/Los_Angeles')).toBe('2026-10-04');
  });

  it('handles year boundaries', () => {
    expect(todayInZone(new Date('2026-12-31T20:00:00Z'), 'Asia/Tokyo')).toBe('2027-01-01');
  });

  it('local hour drives the greeting', () => {
    expect(hourInZone(new Date('2026-10-05T07:00:00Z'), 'UTC')).toBe(7);
    expect(hourInZone(new Date('2026-10-05T00:30:00Z'), 'UTC')).toBe(0);
    expect(greetingFor(0)).toBe('morning');
    expect(greetingFor(11)).toBe('morning');
    expect(greetingFor(12)).toBe('afternoon');
    expect(greetingFor(17)).toBe('afternoon');
    expect(greetingFor(18)).toBe('evening');
  });
});

describe('range presets', () => {
  it('7D and 30D include today and have exactly that many days', () => {
    const r7 = rangeForPreset('7d', '2026-10-05');
    expect(r7).toEqual({ from: '2026-09-29', to: '2026-10-05' });
    expect(daysBetween(r7.from, r7.to) + 1).toBe(7);
    expect(
      daysBetween(...(Object.values(rangeForPreset('30d', '2026-10-05')) as [string, string])) + 1,
    ).toBe(30);
  });

  it('month-based presets start the day after the same date n months ago', () => {
    expect(rangeForPreset('3m', '2026-10-05')).toEqual({ from: '2026-07-06', to: '2026-10-05' });
    expect(rangeForPreset('1y', '2026-10-05')).toEqual({ from: '2025-10-06', to: '2026-10-05' });
    expect(rangeForPreset('1y', '2024-02-29')).toEqual({ from: '2023-03-01', to: '2024-02-29' });
  });

  it('chooses a readable bucket size', () => {
    expect(bucketUnit(rangeForPreset('7d', '2026-10-05'))).toBe('day');
    expect(bucketUnit(rangeForPreset('30d', '2026-10-05'))).toBe('week');
    expect(bucketUnit({ from: '2026-10-01', to: '2026-10-14' })).toBe('day');
    expect(bucketUnit({ from: '2026-10-01', to: '2026-10-15' })).toBe('week');
    expect(bucketUnit(rangeForPreset('3m', '2026-10-05'))).toBe('week');
    expect(bucketUnit(rangeForPreset('6m', '2026-10-05'))).toBe('month');
    expect(bucketUnit(rangeForPreset('1y', '2026-10-05'))).toBe('month');
  });
});

describe('buckets', () => {
  it('cover the range exactly with no gaps or overlaps', () => {
    for (const unit of ['day', 'week', 'month'] as const) {
      for (const range of [
        { from: '2026-09-29', to: '2026-10-05' },
        { from: '2026-07-06', to: '2026-10-05' },
        { from: '2024-02-10', to: '2024-04-03' },
        { from: '2025-12-20', to: '2026-01-10' },
      ]) {
        const buckets = buildBuckets(range, unit);
        expect(buckets[0]!.start).toBe(range.from);
        expect(buckets.at(-1)!.end).toBe(range.to);
        for (let i = 1; i < buckets.length; i++) {
          expect(addDays(buckets[i - 1]!.end, 1)).toBe(buckets[i]!.start);
        }
      }
    }
  });

  it('clips partial weeks and months at the edges', () => {
    const weeks = buildBuckets({ from: '2026-10-07', to: '2026-10-20' }, 'week');
    expect(weeks).toEqual([
      { start: '2026-10-07', end: '2026-10-11' },
      { start: '2026-10-12', end: '2026-10-18' },
      { start: '2026-10-19', end: '2026-10-20' },
    ]);
    const months = buildBuckets({ from: '2026-01-20', to: '2026-03-05' }, 'month');
    expect(months).toEqual([
      { start: '2026-01-20', end: '2026-01-31' },
      { start: '2026-02-01', end: '2026-02-28' },
      { start: '2026-03-01', end: '2026-03-05' },
    ]);
  });

  it('a 30-day range has 30 day buckets when asked for days, and about 5 weekly ones by default', () => {
    expect(buildBuckets(rangeForPreset('30d', '2026-10-05'), 'day')).toHaveLength(30);
    const weekly = buildBuckets(rangeForPreset('30d', '2026-10-05'), 'week');
    expect(weekly.length).toBeGreaterThanOrEqual(5);
    expect(weekly.length).toBeLessThanOrEqual(6);
  });
});

describe('month windows (fair month-over-month comparison)', () => {
  it('compares the same number of days of last month', () => {
    const w = monthWindows('2026-10-05');
    expect(w.current).toEqual({ from: '2026-10-01', to: '2026-10-05' });
    expect(w.previousSamePeriod).toEqual({ from: '2026-09-01', to: '2026-09-05' });
    expect(w.previousFull).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(w.daysElapsed).toBe(5);
    expect(w.daysInMonth).toBe(31);
  });

  it('never runs past the end of a shorter previous month', () => {
    const w = monthWindows('2026-03-31');
    expect(w.previousSamePeriod).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });

  it('crosses the year boundary and honours leap February', () => {
    expect(monthWindows('2027-01-10').previousFull).toEqual({
      from: '2026-12-01',
      to: '2026-12-31',
    });
    expect(monthWindows('2024-03-15').previousFull).toEqual({
      from: '2024-02-01',
      to: '2024-02-29',
    });
    expect(monthWindows('2024-03-30').previousSamePeriod.to).toBe('2024-02-29');
  });
});
