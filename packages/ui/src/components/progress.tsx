import { absMoney, formatMoney, ratioBasisPoints, subtractMoney, type Money } from '@pfm/finance';
import { cn } from '../lib/cn';

export type ProgressTone = 'accent' | 'gain' | 'warn' | 'loss';

const FILL: Record<ProgressTone, string> = {
  accent: 'bg-accent',
  gain: 'bg-gain',
  warn: 'bg-warn',
  loss: 'bg-loss',
};

export interface ProgressBarProps {
  /** Basis points of the goal (10000 = 100%). May exceed 10000. */
  basisPoints: number;
  tone?: ProgressTone;
  label: string;
  /** Optional marker position (basis points), e.g. where you "should" be at this point of the month. */
  markerBasisPoints?: number;
  className?: string;
}

export function ProgressBar({
  basisPoints,
  tone = 'accent',
  label,
  markerBasisPoints,
  className,
}: ProgressBarProps) {
  const pct = Math.max(0, Math.min(basisPoints, 10000)) / 100;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(Math.min(basisPoints, 10000) / 100)}
      className={cn('relative h-1.5 w-full overflow-visible rounded-full bg-sunk', className)}
    >
      <div
        className={cn('h-full origin-left rounded-full', FILL[tone])}
        style={{ width: `${pct}%`, animation: 'pfm-grow var(--dur-chart) var(--ease-out)' }}
      />
      {markerBasisPoints !== undefined ? (
        <div
          aria-hidden
          className="absolute -top-1 h-3.5 w-px bg-ink/60"
          style={{ left: `${Math.max(0, Math.min(markerBasisPoints, 10000)) / 100}%` }}
        />
      ) : null}
    </div>
  );
}

const percent = (bp: number) => `${Math.round(bp / 100)}%`;

export interface BudgetProgressProps {
  name: string;
  spent: Money;
  limit: Money;
  /** Percent (1-100) at which the bar turns to a warning. */
  alertThreshold?: number;
  /** Basis points of the period elapsed: draws a "pace" marker. */
  elapsedBasisPoints?: number;
  /** Server-computed state. When given it decides the bar colour and wording. */
  status?: 'ok' | 'warning' | 'at_risk' | 'over';
  /** Replaces the computed "$180 left" / "Over by $34" text. */
  headline?: string;
  /** A second line of explanation (pace, projection). */
  detail?: string | null;
  className?: string;
}

/** Status is spelled out in words, so state never depends on bar colour alone. */
export function BudgetProgress({
  name,
  spent,
  limit,
  alertThreshold = 80,
  elapsedBasisPoints,
  status: serverStatus,
  headline,
  detail,
  className,
}: BudgetProgressProps) {
  const used = limit.minor > 0 ? ratioBasisPoints(spent, limit) : spent.minor > 0 ? 10000 : 0;
  const over = spent.minor > limit.minor;
  const state = serverStatus ?? (over ? 'over' : used >= alertThreshold * 100 ? 'warning' : 'ok');
  const tone: ProgressTone =
    state === 'over' ? 'loss' : state === 'warning' || state === 'at_risk' ? 'warn' : 'accent';
  const status =
    headline ??
    (over
      ? `Over by ${formatMoney(subtractMoney(spent, limit), { compactFraction: true })}`
      : `${formatMoney(absMoney(subtractMoney(limit, spent)), { compactFraction: true })} left`);

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium">{name}</span>
        <span className="num text-[0.8125rem] text-muted">
          {formatMoney(spent, { compactFraction: true })} of{' '}
          {formatMoney(limit, { compactFraction: true })}
        </span>
      </div>
      <ProgressBar
        basisPoints={used}
        tone={tone}
        label={`${name} budget, ${percent(used)} used`}
        {...(elapsedBasisPoints !== undefined ? { markerBasisPoints: elapsedBasisPoints } : {})}
      />
      <div className="flex justify-between gap-3 text-[0.8125rem]">
        <span
          className={cn(
            state === 'over'
              ? 'font-medium text-loss'
              : state === 'warning' || state === 'at_risk'
                ? 'font-medium text-warn-text'
                : 'text-muted',
          )}
        >
          {state === 'over' ? '\u25B2 ' : state === 'at_risk' || state === 'warning' ? '! ' : ''}
          {status}
        </span>
        <span className="num text-muted">{percent(used)} used</span>
      </div>
      {detail ? <p className="text-[0.8125rem] text-muted">{detail}</p> : null}
    </div>
  );
}

export interface GoalProgressProps {
  name: string;
  current: Money;
  target: Money;
  /** One line of context, e.g. "$300/month to reach it by June". */
  detail?: string;
  /** Server-computed schedule state. `behind` and `overdue` turn the bar amber. */
  status?: 'reached' | 'overdue' | 'no_deadline' | 'ahead' | 'on_track' | 'behind';
  /** Replaces the default left-hand text. */
  headline?: string;
  /** Second line, under the bar (ahead / behind schedule). */
  note?: string | null;
  className?: string;
}

export function GoalProgress({
  name,
  current,
  target,
  detail,
  status,
  headline,
  note,
  className,
}: GoalProgressProps) {
  const done = target.minor > 0 ? ratioBasisPoints(current, target) : 0;
  const reached = status === 'reached' || done >= 10000;
  const tone: ProgressTone = reached
    ? 'gain'
    : status === 'behind' || status === 'overdue'
      ? 'warn'
      : 'accent';
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium">{name}</span>
        <span className="num text-[0.8125rem] text-muted">
          {formatMoney(current, { compactFraction: true })} of{' '}
          {formatMoney(target, { compactFraction: true })}
        </span>
      </div>
      <ProgressBar basisPoints={done} tone={tone} label={`${name} goal, ${percent(done)} saved`} />
      <div className="flex justify-between gap-3 text-[0.8125rem]">
        <span
          className={cn(
            reached
              ? 'font-medium text-gain'
              : tone === 'warn'
                ? 'font-medium text-warn-text'
                : 'text-muted',
          )}
        >
          {reached ? '\u2713 ' : tone === 'warn' ? '! ' : ''}
          {headline ?? (reached ? 'Goal reached' : (detail ?? ''))}
        </span>
        <span className="num text-muted">{percent(done)}</span>
      </div>
      {note ? <p className="text-[0.8125rem] text-muted">{note}</p> : null}
    </div>
  );
}
