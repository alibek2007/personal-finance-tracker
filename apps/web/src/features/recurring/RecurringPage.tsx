import { useState } from 'react';
import { Pause, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { Badge, Button, EmptyState, Skeleton, Stat, toast } from '@pfm/ui';
import { formatMoney, money } from '@pfm/finance';
import type { RecurringDto } from '@pfm/validation';
import { AmountText, useFormatDay } from '../../components/LedgerBits';
import { ApiError } from '../../lib/api';
import { useCurrentUser } from '../../lib/auth';
import { useDeleteRecurring, useRecurring, useUpdateRecurring } from '../../lib/recurring';
import { RecurringDialog } from './RecurringDialog';

const BLOCKED_TEXT = {
  account_archived:
    'Its account is archived, so payments are on hold. Restore the account to continue.',
  category_archived: 'Its category is archived, so payments are on hold. Pick another category.',
} as const;

function RuleRow({ rule, onEdit }: { rule: RecurringDto; onEdit: () => void }) {
  const formatDay = useFormatDay();
  const update = useUpdateRecurring(rule.id);
  const remove = useDeleteRecurring();
  const [confirming, setConfirming] = useState(false);
  const paused = !rule.isActive;

  async function toggle() {
    try {
      const next = await update.mutateAsync({ isActive: paused });
      toast.success(
        paused
          ? `${rule.description} resumed. Next payment ${formatDay(next.nextOccurrence)}.`
          : `${rule.description} paused`,
      );
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Couldn't change that. Try again.");
    }
  }
  async function doDelete() {
    try {
      await remove.mutateAsync(rule.id);
      toast.success(`${rule.description} removed. Past payments stay in your transactions.`);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Couldn't remove that. Try again.");
    }
  }

  return (
    <li className="py-4">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{rule.description}</p>
            {rule.isSubscription ? <Badge>Subscription</Badge> : null}
            {rule.hasEnded ? <Badge>Ended</Badge> : paused ? <Badge>Paused</Badge> : null}
          </div>
          <p className="mt-0.5 text-[0.875rem] text-muted">
            {rule.cadence}
            {rule.isActive && !rule.blocked ? ` · next ${formatDay(rule.nextOccurrence)}` : ''}
            {rule.endDate && !rule.hasEnded ? ` · ends ${formatDay(rule.endDate)}` : ''}
          </p>
          {rule.blocked ? (
            <p role="status" className="mt-1 text-[0.8125rem] text-warn-text">
              {BLOCKED_TEXT[rule.blocked]}
            </p>
          ) : null}
        </div>
        <div className="text-right">
          <AmountText minor={rule.amount} kind={rule.type} currency={rule.currency} />
          {rule.frequency !== 'monthly' || rule.interval !== 1 ? (
            <p className="text-[0.75rem] text-muted">
              about {formatMoney(money(rule.monthlyCost, rule.currency))}
              /month
            </p>
          ) : null}
        </div>
        <div className="flex w-full flex-wrap items-center gap-1 sm:order-last sm:w-auto sm:justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={onEdit}
            aria-label={`Edit ${rule.description}`}
          >
            <Pencil aria-hidden /> Edit
          </Button>
          {!rule.hasEnded ? (
            <Button
              variant="ghost"
              size="sm"
              loading={update.isPending}
              onClick={() => void toggle()}
              aria-label={`${paused ? 'Resume' : 'Pause'} ${rule.description}`}
            >
              {paused ? <Play aria-hidden /> : <Pause aria-hidden />} {paused ? 'Resume' : 'Pause'}
            </Button>
          ) : null}
          {confirming ? (
            <>
              <span className="text-[0.8125rem] text-muted">Remove it?</span>
              <Button
                variant="danger"
                size="sm"
                loading={remove.isPending}
                onClick={() => void doDelete()}
                aria-label={`Yes, remove ${rule.description}`}
              >
                Yes, remove
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                Keep it
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirming(true)}
              aria-label={`Remove ${rule.description}`}
            >
              <Trash2 aria-hidden /> Remove
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}

export function RecurringPage() {
  const user = useCurrentUser();
  const query = useRecurring();
  const [dialog, setDialog] = useState<{ rule: RecurringDto | null } | null>(null);
  const items = query.data?.items ?? [];
  const live = items.filter((r) => r.isActive && !r.hasEnded);
  const inactive = items.filter((r) => !r.isActive || r.hasEnded);
  const totals = query.data?.totals ?? null;
  const fmt = (minor: number, currency: string) =>
    formatMoney(money(minor, currency as never), { locale: user.locale });

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl">Recurring</h1>
          <p className="mt-1 text-muted">
            Bills, subscriptions and paychecks that repeat. Ledger records each one on its day.
          </p>
        </div>
        <Button onClick={() => setDialog({ rule: null })}>
          <Plus aria-hidden /> Add recurring payment
        </Button>
      </div>

      {query.isPending ? (
        <div role="status" aria-label="Loading recurring payments" className="mt-8 space-y-6">
          <Skeleton className="h-16 w-80" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : query.isError ? (
        <EmptyState
          className="mt-8"
          title="Couldn't load your recurring payments"
          description={`${query.error instanceof ApiError ? query.error.message : 'Check your connection.'} Your data is safe.`}
          action={<Button onClick={() => void query.refetch()}>Try again</Button>}
        />
      ) : items.length === 0 ? (
        <EmptyState
          className="mt-8"
          title="No recurring payments yet"
          description="Add rent, a subscription or your salary once and Ledger records it every time it is due, so your balances and budgets stay right without you lifting a finger."
          action={
            <Button onClick={() => setDialog({ rule: null })}>
              <Plus aria-hidden /> Add your first one
            </Button>
          }
        />
      ) : (
        <>
          {totals ? (
            <section aria-label="Recurring costs" className="mt-8 border-b border-rule pb-8">
              <dl className="grid gap-6 sm:grid-cols-3">
                <Stat label="Going out each month" size="large">
                  {fmt(totals.monthlyExpenses, totals.currency)}
                </Stat>
                <Stat label="Coming in each month">
                  {fmt(totals.monthlyIncome, totals.currency)}
                </Stat>
                <Stat label={`Subscriptions (${totals.subscriptionsCount})`}>
                  {fmt(totals.subscriptionsMonthly, totals.currency)}
                  <span className="ml-1 text-base text-muted">/month</span>
                </Stat>
              </dl>
              {totals.subscriptionsCount > 0 ? (
                <p className="mt-5 text-muted">
                  Your subscriptions cost approximately{' '}
                  <strong className="font-semibold text-ink">
                    {fmt(totals.subscriptionsYearly, totals.currency)}
                  </strong>{' '}
                  a year.
                </p>
              ) : null}
              {query.data.excludedCurrencies.length > 0 ? (
                <p className="mt-2 text-[0.8125rem] text-muted">
                  Totals are in {totals.currency}. Payments in{' '}
                  {query.data.excludedCurrencies.join(', ')} are listed but not added in.
                </p>
              ) : null}
            </section>
          ) : (
            <p className="mt-8 text-[0.8125rem] text-muted">
              Totals only count payments in {user.currency}; none of yours are active right now.
            </p>
          )}

          {live.length > 0 ? (
            <ul aria-label="Active recurring payments" className="mt-4 divide-y divide-rule">
              {live.map((r) => (
                <RuleRow key={r.id} rule={r} onEdit={() => setDialog({ rule: r })} />
              ))}
            </ul>
          ) : null}

          {inactive.length > 0 ? (
            <section className="mt-10">
              <h2 className="font-display text-xl">Paused and ended</h2>
              <ul className="mt-2 divide-y divide-rule border-t border-rule">
                {inactive.map((r) => (
                  <RuleRow key={r.id} rule={r} onEdit={() => setDialog({ rule: r })} />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}

      {dialog ? (
        <RecurringDialog
          key={dialog.rule?.id ?? 'new'}
          open
          rule={dialog.rule}
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
        />
      ) : null}
    </div>
  );
}
