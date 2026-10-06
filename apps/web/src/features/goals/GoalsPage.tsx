import { useState } from 'react';
import { Plus } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { Badge, Button, EmptyState, GoalProgress, ProgressBar, Skeleton, Stat } from '@pfm/ui';
import { money } from '@pfm/finance';
import type { GoalDto } from '@pfm/validation';
import { AmountText } from '../../components/LedgerBits';
import { ApiError } from '../../lib/api';
import { useGoals } from '../../lib/goals';
import { GoalDialog } from './GoalDialog';
import { GoalDrawer } from './GoalDrawer';

/** One goal, shown the same way on the Goals page and the dashboard. */
export function GoalRow({ goal, onOpen }: { goal: GoalDto; onOpen?: () => void }) {
  const body = (
    <div className="flex flex-col gap-1.5">
      <GoalProgress
        name={goal.name}
        current={money(Math.max(0, goal.currentAmount), goal.currency)}
        target={money(goal.targetAmount, goal.currency)}
        status={goal.status}
        headline={goal.headline}
        note={goal.detail}
      />
      {goal.deadline ? (
        <p className="text-[0.75rem] text-muted">
          Target date {format(parseISO(goal.deadline), 'MMM d, yyyy')}
        </p>
      ) : null}
    </div>
  );
  if (!onOpen) return body;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${goal.name} goal`}
      className="block w-full rounded-md py-4 text-left transition-colors hover:bg-sunk/50 focus-visible:bg-sunk/50 sm:-mx-3 sm:w-[calc(100%+1.5rem)] sm:px-3"
    >
      {body}
    </button>
  );
}

export function GoalsPage() {
  const query = useGoals();
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const data = query.data;
  const active = data?.goals.filter((g) => !g.isArchived) ?? [];
  const archived = data?.goals.filter((g) => g.isArchived) ?? [];
  const opened = data?.goals.find((g) => g.id === openId) ?? null;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl">Goals</h1>
          <p className="mt-1 text-muted">
            Things you're saving for, and what it takes to get there.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus aria-hidden /> Create goal
        </Button>
      </div>

      {query.isPending ? (
        <div role="status" aria-label="Loading goals" className="mt-8 space-y-6">
          <Skeleton className="h-16 w-80" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : query.isError ? (
        <EmptyState
          className="mt-8"
          title="Couldn't load your goals"
          description={`${query.error instanceof ApiError ? query.error.message : 'Check your connection.'} Your data is safe.`}
          action={<Button onClick={() => void query.refetch()}>Try again</Button>}
        />
      ) : query.data.goals.length === 0 ? (
        <EmptyState
          className="mt-8"
          title="You haven't set a savings goal yet"
          description="A goal turns a vague wish into a monthly number you can act on: an emergency fund, a trip, a new laptop."
          action={
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden /> Create your first goal
            </Button>
          }
        />
      ) : (
        <>
          {query.data.summary ? (
            <section aria-label="Savings summary" className="mt-8 border-b border-rule pb-8">
              <div className="grid gap-6 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] sm:items-end">
                <dl>
                  <Stat
                    label={`Saved toward ${query.data.summary.count} goal${query.data.summary.count === 1 ? '' : 's'}`}
                    size="large"
                  >
                    <AmountText
                      minor={query.data.summary.saved}
                      currency={query.data.summary.currency}
                      compactFraction
                    />
                    <span className="ml-2 text-xl text-muted">
                      of{' '}
                      <AmountText
                        minor={query.data.summary.target}
                        currency={query.data.summary.currency}
                        compactFraction
                      />
                    </span>
                  </Stat>
                </dl>
                <ProgressBar
                  basisPoints={
                    query.data.summary.target > 0
                      ? Math.round((query.data.summary.saved * 10000) / query.data.summary.target)
                      : 0
                  }
                  label="All goals combined"
                />
              </div>
            </section>
          ) : null}

          {active.length > 0 ? (
            <ul className="mt-6 divide-y divide-rule">
              {active.map((g) => (
                <li key={g.id}>
                  <GoalRow goal={g} onOpen={() => setOpenId(g.id)} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-8 text-muted">
              All your goals are archived. Create a new one or restore an old one below.
            </p>
          )}

          {archived.length > 0 ? (
            <section className="mt-10">
              <button
                type="button"
                className="text-[0.9375rem] font-medium text-accent underline-offset-4 hover:underline"
                aria-expanded={showArchived}
                onClick={() => setShowArchived((s) => !s)}
              >
                {showArchived ? 'Hide' : 'Show'} {archived.length} archived goal
                {archived.length === 1 ? '' : 's'}
              </button>
              {showArchived ? (
                <ul className="mt-2 divide-y divide-rule border-t border-rule">
                  {archived.map((g) => (
                    <li key={g.id} className="flex items-center gap-3 py-3">
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => setOpenId(g.id)}
                        aria-label={`Open ${g.name} goal`}
                      >
                        <span className="font-medium">{g.name}</span>{' '}
                        <span className="text-muted">
                          <AmountText
                            minor={g.currentAmount}
                            currency={g.currency}
                            compactFraction
                            tone={false}
                          />{' '}
                          of{' '}
                          <AmountText
                            minor={g.targetAmount}
                            currency={g.currency}
                            compactFraction
                            tone={false}
                          />
                        </span>
                      </button>
                      <Badge>Archived</Badge>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}
        </>
      )}

      <GoalDialog
        key={creating ? 'create-open' : 'create-closed'}
        open={creating}
        goal={null}
        onOpenChange={setCreating}
      />
      <GoalDrawer goal={opened} onClose={() => setOpenId(null)} />
    </div>
  );
}
