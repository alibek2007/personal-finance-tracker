import { useState } from 'react';
import { Plus } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { Badge, BudgetProgress, Button, EmptyState, ProgressBar, Skeleton, Stat } from '@pfm/ui';
import { money } from '@pfm/finance';
import type { BudgetDto } from '@pfm/validation';
import { AmountText } from '../../components/LedgerBits';
import { ApiError } from '../../lib/api';
import { useBudgets } from '../../lib/budgets';
import { BudgetDialog } from './BudgetDialog';

const GROUPS = [
  { period: 'monthly', title: 'Monthly', subtitle: 'Resets on the 1st' },
  { period: 'weekly', title: 'Weekly', subtitle: 'Resets every Monday' },
  { period: 'yearly', title: 'Yearly', subtitle: 'Resets on January 1' },
] as const;

/** The server-computed budget, shown the same way on the Budgets page and the dashboard. */
export function BudgetRow({ budget, onOpen }: { budget: BudgetDto; onOpen?: () => void }) {
  const name = budget.parentCategoryName
    ? `${budget.parentCategoryName} › ${budget.categoryName}`
    : budget.categoryName;
  const body = (
    <BudgetProgress
      name={name}
      spent={money(Math.max(0, budget.spent), budget.currency)}
      limit={money(budget.amount, budget.currency)}
      alertThreshold={budget.alertThreshold}
      elapsedBasisPoints={budget.elapsedBp}
      status={budget.status}
      headline={budget.headline}
      detail={budget.detail}
    />
  );
  if (!onOpen) return body;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Edit ${name} budget`}
      className="block w-full rounded-md py-4 text-left transition-colors hover:bg-sunk/50 focus-visible:bg-sunk/50 sm:px-3 sm:-mx-3 sm:w-[calc(100%+1.5rem)]"
    >
      {body}
    </button>
  );
}

export function BudgetsPage() {
  const query = useBudgets();
  const [editing, setEditing] = useState<BudgetDto | 'new' | null>(null);
  const data = query.data;
  const active = data?.budgets.filter((b) => b.lifecycle === 'active') ?? [];
  const inactive = data?.budgets.filter((b) => b.lifecycle !== 'active') ?? [];

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl">Budgets</h1>
          <p className="mt-1 text-muted">
            A limit for each kind of spending, and how you're pacing against it.
          </p>
        </div>
        <Button onClick={() => setEditing('new')}>
          <Plus aria-hidden /> Set budget
        </Button>
      </div>

      {query.isPending ? (
        <div role="status" aria-label="Loading budgets" className="mt-8 space-y-6">
          <Skeleton className="h-16 w-80" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : query.isError ? (
        <EmptyState
          className="mt-8"
          title="Couldn't load your budgets"
          description={`${query.error instanceof ApiError ? query.error.message : 'Check your connection.'} Your data is safe.`}
          action={<Button onClick={() => void query.refetch()}>Try again</Button>}
        />
      ) : query.data.budgets.length === 0 ? (
        <EmptyState
          className="mt-8"
          title="You haven't set any budgets yet"
          description="Pick a category you want to keep an eye on, like Food or Shopping. Ledger will show how much is left and warn you if you're heading over."
          action={
            <Button onClick={() => setEditing('new')}>
              <Plus aria-hidden /> Set your first budget
            </Button>
          }
        />
      ) : (
        <>
          {query.data.monthly ? (
            <section aria-label="Monthly summary" className="mt-8 border-b border-rule pb-8">
              <div className="grid gap-6 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] sm:items-end">
                <dl>
                  <Stat
                    label={`Spent of ${query.data.monthly.count} monthly budget${query.data.monthly.count === 1 ? '' : 's'}`}
                    size="large"
                  >
                    <AmountText
                      minor={query.data.monthly.spent}
                      currency={query.data.monthly.currency}
                      compactFraction
                    />
                    <span className="ml-2 text-xl text-muted">
                      of{' '}
                      <AmountText
                        minor={query.data.monthly.budgeted}
                        currency={query.data.monthly.currency}
                        compactFraction
                      />
                    </span>
                  </Stat>
                </dl>
                <div>
                  <ProgressBar
                    basisPoints={
                      query.data.monthly.budgeted > 0
                        ? Math.round(
                            (query.data.monthly.spent * 10000) / query.data.monthly.budgeted,
                          )
                        : 0
                    }
                    label="All monthly budgets combined"
                    tone={
                      query.data.monthly.spent > query.data.monthly.budgeted ? 'loss' : 'accent'
                    }
                  />
                  <p className="mt-2 text-[0.8125rem] text-muted">
                    {query.data.monthly.spent > query.data.monthly.budgeted ? (
                      <>
                        Over by{' '}
                        <AmountText
                          minor={query.data.monthly.spent - query.data.monthly.budgeted}
                          currency={query.data.monthly.currency}
                          compactFraction
                          tone={false}
                        />{' '}
                        across your monthly budgets
                      </>
                    ) : (
                      <>
                        <AmountText
                          minor={query.data.monthly.budgeted - query.data.monthly.spent}
                          currency={query.data.monthly.currency}
                          compactFraction
                          tone={false}
                        />{' '}
                        left across your monthly budgets
                      </>
                    )}
                  </p>
                </div>
              </div>
            </section>
          ) : null}

          {GROUPS.map((group) => {
            const rows = active.filter((b) => b.period === group.period);
            if (rows.length === 0) return null;
            return (
              <section
                key={group.period}
                className="mt-10"
                aria-labelledby={`budgets-${group.period}`}
              >
                <div className="flex items-baseline gap-3">
                  <h2 id={`budgets-${group.period}`} className="font-display text-xl">
                    {group.title}
                  </h2>
                  <span className="text-[0.8125rem] text-muted">{group.subtitle}</span>
                </div>
                <ul className="mt-2 divide-y divide-rule border-t border-rule">
                  {rows
                    .slice()
                    .sort((a, b) => b.usedBp - a.usedBp)
                    .map((b) => (
                      <li key={b.id}>
                        <BudgetRow budget={b} onOpen={() => setEditing(b)} />
                      </li>
                    ))}
                </ul>
              </section>
            );
          })}

          {inactive.length > 0 ? (
            <section className="mt-10" aria-labelledby="budgets-inactive">
              <h2 id="budgets-inactive" className="font-display text-xl">
                Not active
              </h2>
              <ul className="mt-2 divide-y divide-rule border-t border-rule">
                {inactive.map((b) => (
                  <li key={b.id} className="flex items-center gap-3 py-3">
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => setEditing(b)}
                      aria-label={`Edit ${b.categoryName} budget`}
                    >
                      <span className="font-medium">{b.categoryName}</span>{' '}
                      <span className="text-muted">
                        <AmountText
                          minor={b.amount}
                          currency={b.currency}
                          compactFraction
                          tone={false}
                        />{' '}
                        {b.period}
                      </span>
                    </button>
                    <Badge>
                      {b.lifecycle === 'upcoming'
                        ? `Starts ${format(parseISO(b.startDate), 'MMM d')}`
                        : `Ended ${b.endDate ? format(parseISO(b.endDate), 'MMM d') : ''}`}
                    </Badge>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}

      <BudgetDialog
        key={editing === 'new' ? 'new' : (editing?.id ?? 'closed')}
        open={editing !== null}
        budget={editing && editing !== 'new' ? editing : null}
        onOpenChange={(open) => !open && setEditing(null)}
      />
    </div>
  );
}
