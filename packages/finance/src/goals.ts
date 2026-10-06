import { daysBetween, parseIso } from './periods';

/** Average month length. Used only to turn "days left" into "months left" for a monthly savings figure. */
const DAYS_PER_MONTH = 30.4375;

/** How close to the straight-line plan still counts as "on schedule" (2% of the target). */
const ON_SCHEDULE_BP = 200;

export type GoalStatus = 'reached' | 'overdue' | 'no_deadline' | 'ahead' | 'on_track' | 'behind';

export interface GoalInput {
  target: number;
  current: number;
  /** YYYY-MM-DD, or null for an open-ended goal. */
  deadline: string | null;
  today: string;
  /** The day saving began (earliest of creation and first contribution). Needed for the schedule comparison. */
  startedOn: string;
}

export interface GoalState {
  progressBp: number;
  remaining: number;
  /** Saved beyond the target. */
  surplus: number;
  reached: boolean;
  daysLeft: number | null;
  monthsLeft: number | null;
  /** What to put aside each month to finish on time (rounded up so it actually gets there). */
  requiredMonthly: number | null;
  /** Where the straight-line plan says you should be today. */
  expectedAmount: number | null;
  /** current - expected: positive = ahead. */
  scheduleDelta: number | null;
  status: GoalStatus;
}

/** Whole months needed to cover the days left, at least one. Zero once the deadline has passed. */
export function monthsUntil(today: string, deadline: string): number {
  const days = daysBetween(today, deadline);
  if (days <= 0) return 0;
  return Math.max(1, Math.ceil(days / DAYS_PER_MONTH));
}

export function computeGoalState(input: GoalInput): GoalState {
  const { target, current, deadline, today, startedOn } = input;
  if (!Number.isSafeInteger(target) || target <= 0)
    throw new Error('A goal target must be a positive amount');

  const progressBp = Math.round((current * 10000) / target);
  const remaining = Math.max(0, target - current);
  const reached = current >= target;
  const surplus = Math.max(0, current - target);

  if (deadline === null) {
    return {
      progressBp,
      remaining,
      surplus,
      reached,
      daysLeft: null,
      monthsLeft: null,
      requiredMonthly: null,
      expectedAmount: null,
      scheduleDelta: null,
      status: reached ? 'reached' : 'no_deadline',
    };
  }

  const daysLeft = daysBetween(today, deadline);
  const monthsLeft = monthsUntil(today, deadline);
  const overdue = !reached && daysLeft < 0;

  // Straight line from 0 on the day saving began to the full target on the deadline.
  const total = Math.max(1, daysBetween(startedOn, deadline));
  const elapsed = Math.min(total, Math.max(0, daysBetween(startedOn, today)));
  const expectedAmount = Math.round((target * elapsed) / total);
  const scheduleDelta = current - expectedAmount;

  let status: GoalStatus;
  if (reached) status = 'reached';
  else if (overdue) status = 'overdue';
  else if (Math.abs((scheduleDelta * 10000) / target) <= ON_SCHEDULE_BP) status = 'on_track';
  else status = scheduleDelta > 0 ? 'ahead' : 'behind';

  return {
    progressBp,
    remaining,
    surplus,
    reached,
    daysLeft,
    monthsLeft: reached ? null : monthsLeft,
    requiredMonthly: reached || monthsLeft === 0 ? null : Math.ceil(remaining / monthsLeft),
    expectedAmount,
    scheduleDelta,
    status,
  };
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "June" when the deadline is this year, "June 2027" otherwise. */
export function deadlineLabel(deadline: string, today: string): string {
  const d = parseIso(deadline);
  const t = parseIso(today);
  const month = MONTHS[d.m - 1] ?? '';
  return d.y === t.y ? month : `${month} ${d.y}`;
}

export interface GoalMessage {
  headline: string;
  detail: string | null;
}

/** Plain-language summary. `fmt` formats a non-negative amount of minor units. */
export function describeGoal(
  state: GoalState,
  deadline: string | null,
  today: string,
  fmt: (minor: number) => string,
): GoalMessage {
  const label = deadline ? deadlineLabel(deadline, today) : null;
  switch (state.status) {
    case 'reached':
      return {
        headline: 'Goal reached',
        detail: state.surplus > 0 ? `You're ${fmt(state.surplus)} over your target.` : null,
      };
    case 'overdue':
      return {
        headline: `${fmt(state.remaining)} to go`,
        detail: `The deadline (${label}) has passed. Move it, or keep going.`,
      };
    case 'no_deadline':
      return {
        headline: `${fmt(state.remaining)} to go`,
        detail: 'Add a deadline to see how much to save each month.',
      };
    case 'ahead':
    case 'on_track':
    case 'behind': {
      const delta = Math.abs(state.scheduleDelta ?? 0);
      const schedule =
        state.status === 'ahead'
          ? `You're ${fmt(delta)} ahead of schedule.`
          : state.status === 'behind'
            ? `You're ${fmt(delta)} behind schedule.`
            : "You're right on schedule.";
      return {
        headline:
          state.requiredMonthly !== null
            ? `${fmt(state.requiredMonthly)}/month to reach your goal by ${label}`
            : `${fmt(state.remaining)} to go`,
        detail: schedule,
      };
    }
  }
}
