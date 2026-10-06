import { formatMoney, money, type CurrencyCode } from '@pfm/finance';
import { cn } from '@pfm/ui';
import { useCurrentUser } from '../../lib/auth';

/** Money for tooltips and tables, in the user's locale. */
export function useMoneyFormat() {
  const { locale } = useCurrentUser();
  return {
    full: (minor: number, currency: CurrencyCode, signed = false) =>
      formatMoney(money(minor, currency), {
        locale,
        ...(signed ? { signDisplay: 'always' as const } : {}),
      }),
    whole: (minor: number, currency: CurrencyCode) =>
      formatMoney(money(minor, currency), { locale, compactFraction: true }),
  };
}

export interface TipRow {
  label: string;
  value: string;
  /** A coloured square, only ever a supplement to the label. */
  swatch?: string;
  strong?: boolean;
}

export function TooltipBox({ title, rows }: { title: string; rows: TipRow[] }) {
  return (
    <div className="rounded-md border border-rule-strong bg-surface px-3 py-2 text-[0.8125rem] shadow-float">
      <p className="mb-1 font-medium">{title}</p>
      <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5">
        {rows.map((r) => (
          <div key={r.label} className="contents">
            <dt className="flex items-center gap-1.5 text-muted">
              {r.swatch ? (
                <span aria-hidden className="size-2 rounded-sm" style={{ background: r.swatch }} />
              ) : null}
              {r.label}
            </dt>
            <dd className={cn('num m-0 text-right', r.strong && 'font-medium')}>{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * A change in words with a glyph; colour is only reinforcement.
 * `short` drops the comparison phrase for tables whose header already says what it is compared with.
 */
export function ChangeText({
  bp,
  good,
  versus,
  short = false,
}: {
  bp: number | null;
  good: 'up' | 'down';
  versus: string;
  short?: boolean;
}) {
  if (bp === null)
    return (
      <span className="text-muted">
        {short ? 'No data to compare' : `Nothing to compare with ${versus}`}
      </span>
    );
  if (Math.abs(bp) < 50)
    return (
      <span className="text-muted">{short ? 'About the same' : `About the same as ${versus}`}</span>
    );
  const up = bp > 0;
  const better = (up && good === 'up') || (!up && good === 'down');
  return (
    <span className={cn(better ? 'text-gain' : 'text-loss')}>
      <span aria-hidden>{up ? '▲' : '▼'}</span> {Math.round(Math.abs(bp) / 100)}%{' '}
      {up ? 'more' : 'less'}
      {short ? '' : ` than ${versus}`}
    </span>
  );
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-[0.8125rem]">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-2">
          <span aria-hidden className="size-2.5 rounded-sm" style={{ background: i.color }} />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/** Honest scope note for charts that ignore some of the filters. */
export function ScopeNote({ children }: { children: string }) {
  return <p className="mt-2 text-[0.75rem] text-muted">{children}</p>;
}

export const CHART_AXIS = { fill: 'var(--muted)', fontSize: 12 } as const;
