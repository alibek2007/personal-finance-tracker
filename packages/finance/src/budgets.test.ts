import { describe, expect, it } from 'vitest';
import {
  budgetLifecycle,
  budgetPeriodRange,
  computeBudgetState,
  describeBudget,
  previousPeriods,
  type BudgetStatusInput,
} from './budgets';

describe('budgetPeriodRange', () => {
  it('monthly is the calendar month, including leap February', () => {
    expect(budgetPeriodRange('monthly', '2026-10-15')).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(budgetPeriodRange('monthly', '2024-02-10')).toEqual({
      from: '2024-02-01',
      to: '2024-02-29',
    });
    expect(budgetPeriodRange('monthly', '2026-02-28')).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
  });

  it('weekly runs Monday to Sunday and may span two months or two years', () => {
    expect(budgetPeriodRange('weekly', '2026-10-15')).toEqual({
      from: '2026-10-12',
      to: '2026-10-18',
    });
    expect(budgetPeriodRange('weekly', '2026-10-01')).toEqual({
      from: '2026-09-28',
      to: '2026-10-04',
    });
    expect(budgetPeriodRange('weekly', '2026-12-31')).toEqual({
      from: '2026-12-28',
      to: '2027-01-03',
    });
    expect(budgetPeriodRange('weekly', '2026-10-18')).toEqual({
      from: '2026-10-12',
      to: '2026-10-18',
    }); // Sunday
  });

  it('yearly is the calendar year', () => {
    expect(budgetPeriodRange('yearly', '2026-06-30')).toEqual({
      from: '2026-01-01',
      to: '2026-12-31',
    });
  });
});

describe('previousPeriods', () => {
  it('walks back whole periods without gaps or overlap', () => {
    const months = previousPeriods('monthly', '2026-03-31', 3);
    expect(months).toEqual([
      { from: '2026-02-01', to: '2026-02-28' },
      { from: '2026-01-01', to: '2026-01-31' },
      { from: '2025-12-01', to: '2025-12-31' },
    ]);
    const weeks = previousPeriods('weekly', '2026-10-15', 2);
    expect(weeks).toEqual([
      { from: '2026-10-05', to: '2026-10-11' },
      { from: '2026-09-28', to: '2026-10-04' },
    ]);
    expect(previousPeriods('yearly', '2026-10-15', 1)).toEqual([
      { from: '2025-01-01', to: '2025-12-31' },
    ]);
  });

  it('handles the 31st clamping into short months', () => {
    expect(previousPeriods('monthly', '2026-05-31', 1)[0]).toEqual({
      from: '2026-04-01',
      to: '2026-04-30',
    });
  });
});

describe('budgetLifecycle', () => {
  it('is upcoming before the start, ended after the end, otherwise active', () => {
    expect(budgetLifecycle('2026-11-01', null, '2026-10-15')).toBe('upcoming');
    expect(budgetLifecycle('2026-01-01', '2026-09-30', '2026-10-15')).toBe('ended');
    expect(budgetLifecycle('2026-01-01', '2026-10-15', '2026-10-15')).toBe('active'); // last day counts
    expect(budgetLifecycle('2026-10-15', null, '2026-10-15')).toBe('active');
  });
});

describe('computeBudgetState', () => {
  const base = (over: Partial<BudgetStatusInput> = {}): BudgetStatusInput => ({
    limit: 50000,
    spent: 20000,
    period: { from: '2026-10-01', to: '2026-10-31' },
    today: '2026-10-15',
    transactionCount: 6,
    alertThreshold: 80,
    currency: 'USD',
    ...over,
  });

  it('computes spent, remaining, percentage and days', () => {
    const s = computeBudgetState(base());
    expect(s).toMatchObject({
      remaining: 30000,
      usedBp: 4000,
      daysTotal: 31,
      daysElapsed: 15,
      daysRemaining: 16,
      elapsedBp: 4839,
      status: 'ok',
    });
    expect(s.dailyAllowance).toBe(1875); // 30,000 / 16
  });

  it('is exact on boundaries: first day, last day', () => {
    expect(
      computeBudgetState(base({ today: '2026-10-01', spent: 0, transactionCount: 0 })).daysElapsed,
    ).toBe(1);
    const last = computeBudgetState(base({ today: '2026-10-31' }));
    expect(last).toMatchObject({ daysElapsed: 31, daysRemaining: 0, dailyAllowance: null });
  });

  it('projects overspending when the pace says so, and quantifies it', () => {
    // 35,000 spent in 15 of 31 days (70% used, below the 80% alert) -> 35,000 + 35,000*16/15 = 72,333 projected
    const s = computeBudgetState(base({ spent: 35000, transactionCount: 9 }));
    expect(s.projectedSpent).toBe(72333);
    expect(s.projectedOver).toBe(22333);
    expect(s.status).toBe('at_risk');
  });

  it('does not project from too little evidence (rent paid on the 1st)', () => {
    const rent = computeBudgetState(
      base({ limit: 185000, spent: 185000, transactionCount: 1, today: '2026-10-02' }),
    );
    expect(rent.projectedSpent).toBeNull();
    expect(rent.status).toBe('warning'); // 100% used but not over
    const early = computeBudgetState(
      base({ spent: 30000, transactionCount: 5, today: '2026-10-04' }),
    );
    expect(early.projectedSpent).toBeNull(); // only 13% of the month has passed
  });

  it('ignores a projected overshoot that is trivially small', () => {
    // pace lands 1% over the limit: not worth a warning
    const s = computeBudgetState(
      base({ limit: 100000, spent: 48500, transactionCount: 8, today: '2026-10-16' }),
    );
    expect(s.projectedSpent).toBe(48500 + Math.round((48500 * 15) / 16));
    expect(s.projectedOver).toBeNull();
    expect(s.status).toBe('ok');
  });

  it('warns at the alert threshold, over at more than the limit', () => {
    expect(computeBudgetState(base({ spent: 35000 })).status).toBe('at_risk'); // 70%: under the alert, but the pace says trouble
    expect(computeBudgetState(base({ spent: 40000 })).status).toBe('warning'); // exactly 80% reaches the alert
    expect(computeBudgetState(base({ spent: 41000, transactionCount: 2 })).status).toBe('warning'); // 82% >= 80%
    expect(computeBudgetState(base({ spent: 50000 })).status).toBe('warning'); // exactly at the limit is not over
    const over = computeBudgetState(base({ spent: 50001 }));
    expect(over).toMatchObject({
      status: 'over',
      remaining: -1,
      projectedSpent: null,
      dailyAllowance: null,
    });
  });

  it('respects a custom alert threshold', () => {
    expect(
      computeBudgetState(base({ spent: 30000, alertThreshold: 50, transactionCount: 2 })).status,
    ).toBe('warning');
    expect(
      computeBudgetState(base({ spent: 30000, alertThreshold: 100, transactionCount: 2 })).status,
    ).toBe('ok');
  });

  it('works for a week that spans two months', () => {
    const s = computeBudgetState({
      limit: 10000,
      spent: 5000,
      period: { from: '2026-09-28', to: '2026-10-04' },
      today: '2026-10-01',
      transactionCount: 4,
      alertThreshold: 80,
      currency: 'USD',
    });
    expect(s).toMatchObject({ daysTotal: 7, daysElapsed: 4, daysRemaining: 3 });
    expect(s.projectedSpent).toBe(5000 + Math.round((5000 * 3) / 4));
  });

  it('a budget with nothing spent is simply ok', () => {
    const s = computeBudgetState(base({ spent: 0, transactionCount: 0 }));
    expect(s).toMatchObject({ status: 'ok', usedBp: 0, projectedSpent: null });
  });

  it('refuses a zero or fractional limit instead of dividing by it', () => {
    expect(() => computeBudgetState(base({ limit: 0 }))).toThrow();
    expect(() => computeBudgetState(base({ limit: 10.5 }))).toThrow();
  });
});

describe('describeBudget', () => {
  const fmt = (n: number) => `$${(n / 100).toFixed(0)}`;
  const state = (over: Partial<BudgetStatusInput> = {}) =>
    computeBudgetState({
      limit: 50000,
      spent: 20000,
      period: { from: '2026-10-01', to: '2026-10-31' },
      today: '2026-10-15',
      transactionCount: 6,
      alertThreshold: 80,
      currency: 'USD',
      ...over,
    });

  it('on track: remaining and a daily allowance', () => {
    expect(describeBudget(state(), fmt)).toEqual({
      headline: '$300 left',
      detail: 'About $19 a day for 16 more days.',
    });
  });

  it('at risk: says how much over, in the words of the brief', () => {
    expect(describeBudget(state({ spent: 35000, transactionCount: 9 }), fmt).detail).toBe(
      'At your current pace, you may exceed this budget by $223.',
    );
  });

  it('over: states the overage and the percentage', () => {
    expect(describeBudget(state({ spent: 58000 }), fmt)).toEqual({
      headline: 'Over by $80',
      detail: "You've used 116% of this budget.",
    });
  });

  it('warning: states usage', () => {
    expect(describeBudget(state({ spent: 42000, transactionCount: 2 }), fmt)).toEqual({
      headline: '$80 left',
      detail: "You've used 84% of this budget.",
    });
  });

  it('handles an untouched budget and the last day', () => {
    expect(describeBudget(state({ spent: 0, transactionCount: 0 }), fmt).detail).toBe(
      'Nothing spent yet.',
    );
    expect(describeBudget(state({ today: '2026-10-31' }), fmt).detail).toBe(
      'Last day of this period.',
    );
  });
});
