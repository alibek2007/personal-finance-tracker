import type { HTMLAttributes, ReactNode } from 'react';
import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/cn';

/** Use sparingly: only where grouping genuinely needs a boundary. Prefer rules and whitespace. */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg border border-rule bg-surface', className)} {...props} />;
}

const badgeStyles = cva(
  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
  {
    variants: {
      tone: {
        neutral: 'bg-sunk text-muted',
        accent: 'bg-accent-wash text-accent',
        gain: 'bg-gain-wash text-gain',
        loss: 'bg-loss-wash text-loss',
        warn: 'bg-warn-wash text-warn-text',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export function Badge({
  className,
  tone,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeStyles>) {
  return <span className={cn(badgeStyles({ tone }), className)} {...props} />;
}

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn(
        'rounded-md opacity-70 bg-[linear-gradient(90deg,var(--rule)_25%,var(--rule-strong)_50%,var(--rule)_75%)] bg-[length:200%_100%]',
        className,
      )}
      style={{ animation: 'pfm-shimmer 1.4s linear infinite' }}
      {...props}
    />
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (
    (
      (parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')
    ).toUpperCase() || '?'
  );
}

export function Avatar({
  name,
  src,
  className,
}: {
  name: string;
  src?: string | null | undefined;
  className?: string;
}) {
  return (
    <AvatarPrimitive.Root
      className={cn(
        'inline-flex size-9 shrink-0 select-none overflow-hidden rounded-full bg-accent-wash',
        className,
      )}
    >
      {src ? <AvatarPrimitive.Image src={src} alt="" className="size-full object-cover" /> : null}
      <AvatarPrimitive.Fallback
        delayMs={src ? 300 : 0}
        className="flex size-full items-center justify-center text-[0.8125rem] font-semibold text-accent"
      >
        {initials(name)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}

export interface StatProps {
  label: string;
  /** The value itself (usually an <Amount />). */
  children: ReactNode;
  /** Secondary line: comparison, context. */
  note?: ReactNode;
  /** Use `large` for the single hero figure on a screen. */
  size?: 'default' | 'large';
  className?: string;
}

/** A labelled figure. Deliberately no card chrome: hierarchy comes from type and rules. */
export function Stat({ label, children, note, size = 'default', className }: StatProps) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <dt className="text-[0.8125rem] text-muted">{label}</dt>
      <dd className="m-0">
        <div
          className={cn(
            'font-display-num leading-none tracking-tight',
            size === 'large'
              ? 'text-[clamp(2.5rem,6vw,3.5rem)] font-medium'
              : 'text-[1.75rem] font-medium',
          )}
        >
          {children}
        </div>
        {note ? <div className="mt-1.5 text-[0.8125rem] text-muted">{note}</div> : null}
      </dd>
    </div>
  );
}

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  /** Heading level: 2 under a page title (default), 3 inside a card that has its own h2. */
  level?: 2 | 3;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  level = 2,
}: EmptyStateProps) {
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <div
      className={cn(
        'flex flex-col items-start gap-3 border-t border-rule py-10 sm:items-center sm:text-center',
        className,
      )}
    >
      {icon ? <div className="text-muted [&_svg]:size-6">{icon}</div> : null}
      <Heading className="font-display text-xl">{title}</Heading>
      {description ? <p className="max-w-md text-muted">{description}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

export interface ChartCardProps {
  /** Phrase as the question the chart answers: "Where did my money go?" */
  title: string;
  description?: string;
  actions?: ReactNode;
  /** Plain-language summary for screen readers; also the chart's accessible name. */
  summary?: string;
  /**
   * Set when the chart area contains controls (a clickable legend). A role="img" may not contain
   * interactive elements, so the card then leaves the labelling of the graphic itself to the caller.
   */
  interactive?: boolean;
  loading?: boolean;
  empty?: { title: string; description?: string; action?: ReactNode } | undefined;
  /** Accessible data-table equivalent of the chart (visually hidden). */
  dataTable?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function ChartCard({
  title,
  description,
  actions,
  summary,
  interactive,
  loading,
  empty,
  dataTable,
  className,
  children,
}: ChartCardProps) {
  return (
    <section className={cn('flex flex-col gap-4', className)} aria-busy={loading || undefined}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl">{title}</h2>
          {description ? <p className="text-[0.8125rem] text-muted">{description}</p> : null}
        </div>
        {actions}
      </header>
      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : empty ? (
        <EmptyState level={3} {...empty} />
      ) : (
        <>
          {interactive ? (
            <div>{children}</div>
          ) : (
            <div role="img" aria-label={summary ?? title}>
              {children}
            </div>
          )}
          {dataTable ? <div className="sr-only">{dataTable}</div> : null}
        </>
      )}
    </section>
  );
}
