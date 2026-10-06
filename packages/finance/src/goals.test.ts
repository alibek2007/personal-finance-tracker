import { describe, expect, it } from 'vitest';
import {
  computeGoalState,
  deadlineLabel,
  describeGoal,
  monthsUntil,
  type GoalInput,
} from './goals';

const base = (over: Partial<GoalInput> = {}): GoalInput => ({
  target: 500000,
  current: 320000,
  deadline: '2027-06-15',
  today: '2026-10-05',
  startedOn: '2026-04-05',
  ...over,
});

describe('monthsUntil', () => {
  it('rounds up to whole months, at least one, and zero once past', () => {
    expect(monthsUntil('2026-10-05', '2026-10-06')).toBe(1);
    expect(monthsUntil('2026-10-05', '2026-11-05')).toBe(2); // 31 days > one average month
    expect(monthsUntil('2026-10-05', '2026-10-05')).toBe(0);
    expect(monthsUntil('2026-10-05', '2026-09-30')).toBe(0);
    expect(monthsUntil('2026-10-05', '2027-10-05')).toBe(12);
  });

  it('is exact across a leap day', () => {
    expect(monthsUntil('2024-02-01', '2024-03-01')).toBe(1); // 29 days
    expect(monthsUntil('2026-02-01', '2026-03-01')).toBe(1); // 28 days
  });
});

describe('computeGoalState', () => {
  it('progress, remaining and the monthly amount needed', () => {
    const s = computeGoalState(base());
    expect(s).toMatchObject({ progressBp: 6400, remaining: 180000, reached: false, surplus: 0 });
    // 253 days to 2027-06-15 is about 8.3 months -> 9 months
    expect(s.monthsLeft).toBe(9);
    expect(s.requiredMonthly).toBe(20000); // 180,000 / 9
  });

  it('rounds the monthly figure up so saving it actually finishes the goal', () => {
    const s = computeGoalState(
      base({ target: 100001, current: 0, deadline: '2026-12-31', today: '2026-10-05' }),
    );
    expect(s.requiredMonthly! * s.monthsLeft!).toBeGreaterThanOrEqual(100001);
  });

  it('compares with a straight-line plan and says ahead / behind / on track', () => {
    // started 2026-04-05, deadline 2027-06-15 => 436 days; 183 elapsed => expected 209,862
    const s = computeGoalState(base());
    expect(s.expectedAmount).toBe(209862);
    expect(s.scheduleDelta).toBe(110138);
    expect(s.status).toBe('ahead');
    expect(computeGoalState(base({ current: 100000 })).status).toBe('behind');
    expect(computeGoalState(base({ current: 209862 + 3000 })).status).toBe('on_track'); // within 2% of the target
  });

  it('reaching the target wins over everything else, including a passed deadline', () => {
    const done = computeGoalState(base({ current: 500000 }));
    expect(done).toMatchObject({
      status: 'reached',
      reached: true,
      requiredMonthly: null,
      remaining: 0,
      surplus: 0,
      monthsLeft: null,
    });
    const over = computeGoalState(base({ current: 530000, deadline: '2026-01-01' }));
    expect(over).toMatchObject({ status: 'reached', surplus: 30000 });
  });

  it('a missed deadline is "overdue" and asks for no monthly figure', () => {
    const s = computeGoalState(base({ deadline: '2026-09-30' }));
    expect(s).toMatchObject({ status: 'overdue', requiredMonthly: null, daysLeft: -5 });
  });

  it('the deadline day itself is still on time', () => {
    const s = computeGoalState(base({ deadline: '2026-10-05' }));
    expect(s.status).not.toBe('overdue');
    expect(s.requiredMonthly).toBeNull(); // nothing sensible per month with zero months left
  });

  it('a goal without a deadline has no schedule and no monthly figure', () => {
    const s = computeGoalState(base({ deadline: null }));
    expect(s).toMatchObject({
      status: 'no_deadline',
      requiredMonthly: null,
      expectedAmount: null,
      scheduleDelta: null,
      monthsLeft: null,
    });
  });

  it('copes with saving that started the same day as the deadline or after it', () => {
    const s = computeGoalState(base({ startedOn: '2027-06-15' }));
    expect(Number.isFinite(s.expectedAmount)).toBe(true);
  });

  it('refuses a zero target', () => {
    expect(() => computeGoalState(base({ target: 0 }))).toThrow();
  });

  it('progress may exceed 100% (over-funded) and stays exact', () => {
    expect(computeGoalState(base({ current: 750000 })).progressBp).toBe(15000);
  });
});

describe('deadlineLabel', () => {
  it('names the month, adding the year when it is not this year', () => {
    expect(deadlineLabel('2026-12-31', '2026-10-05')).toBe('December');
    expect(deadlineLabel('2027-06-15', '2026-10-05')).toBe('June 2027');
  });
});

describe('describeGoal', () => {
  const fmt = (n: number) => `$${(n / 100).toLocaleString('en-US')}`;
  const msg = (over: Partial<GoalInput> = {}) => {
    const input = base(over);
    return describeGoal(computeGoalState(input), input.deadline, input.today, fmt);
  };

  it('uses the wording from the brief when there is a deadline', () => {
    expect(
      msg({ deadline: '2026-12-31', current: 100000, target: 400000, startedOn: '2026-10-01' })
        .headline,
    ).toBe('$1,000/month to reach your goal by December');
  });

  it('says how far ahead or behind the plan you are', () => {
    expect(msg().detail).toBe("You're $1,101.38 ahead of schedule.");
    expect(msg({ current: 100000 }).detail).toMatch(/behind schedule/);
    expect(msg({ current: 212862 }).detail).toBe("You're right on schedule.");
  });

  it('celebrates, and notes any surplus', () => {
    expect(msg({ current: 500000 })).toEqual({ headline: 'Goal reached', detail: null });
    expect(msg({ current: 512300 }).detail).toBe("You're $123 over your target.");
  });

  it('is gentle when the deadline has passed or none was set', () => {
    expect(msg({ deadline: '2026-09-30' })).toEqual({
      headline: '$1,800 to go',
      detail: 'The deadline (September) has passed. Move it, or keep going.',
    });
    expect(msg({ deadline: null })).toEqual({
      headline: '$1,800 to go',
      detail: 'Add a deadline to see how much to save each month.',
    });
  });
});
