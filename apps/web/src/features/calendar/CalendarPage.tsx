import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { ChevronLeft, ChevronRight, Repeat, Target } from 'lucide-react';
import { Badge, Button, EmptyState, Skeleton, Stat, cn } from '@pfm/ui';
import {
  addDays,
  addMonths,
  daysBetween,
  endOfMonth,
  formatMoney,
  money,
  startOfMonth,
  startOfWeek,
} from '@pfm/finance';
import type { CalendarDayDto } from '@pfm/validation';
import { AmountText, useToday } from '../../components/LedgerBits';
import { ApiError } from '../../lib/api';
import { useCurrentUser } from '../../lib/auth';
import { useCalendar } from '../../lib/calendar';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const MONTH_PARAM = /^\d{4}-(0[1-9]|1[0-2])$/;

export function CalendarPage() {
  const user = useCurrentUser();
  const today = useToday();
  const [params, setParams] = useSearchParams();

  const monthParam = params.get('month');
  const monthStart = startOfMonth(
    monthParam && MONTH_PARAM.test(monthParam) ? `${monthParam}-01` : today,
  );
  const monthEnd = endOfMonth(monthStart);
  const gridStart = startOfWeek(monthStart);
  const weeks = Math.ceil((daysBetween(gridStart, monthEnd) + 1) / 7);
  const gridEnd = addDays(gridStart, weeks * 7 - 1);

  const selectedParam = params.get('day');
  const selected =
    selectedParam && selectedParam >= monthStart && selectedParam <= monthEnd
      ? selectedParam
      : today >= monthStart && today <= monthEnd
        ? today
        : monthStart;

  const query = useCalendar(gridStart, gridEnd);
  const byDate = useMemo(
    () => new Map((query.data?.days ?? []).map((d) => [d.date, d])),
    [query.data],
  );

  const go = (changes: Record<string, string | null>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(changes)) {
          if (v === null) next.delete(k);
          else next.set(k, v);
        }
        return next;
      },
      { replace: true },
    );
  const goMonth = (iso: string) => go({ month: iso.slice(0, 7), day: null });

  const fmt = (minor: number, currency = user.currency) =>
    formatMoney(money(minor, currency), { locale: user.locale, compactFraction: true });

  const inMonth = (query.data?.days ?? []).filter(
    (d) => d.date >= monthStart && d.date <= monthEnd,
  );
  const spent = inMonth.reduce((s, d) => s + d.expense, 0);
  const earned = inMonth.reduce((s, d) => s + d.income, 0);
  const dueCount = inMonth.reduce((s, d) => s + d.upcoming.length, 0);

  const cells = Array.from({ length: weeks * 7 }, (_, i) => addDays(gridStart, i));
  const day = byDate.get(selected);

  function label(date: string, d: CalendarDayDto | undefined): string {
    const parts = [format(parseISO(date), 'EEEE, MMMM d')];
    if (date === today) parts.push('today');
    if (d) {
      if (d.expense > 0) parts.push(`spent ${fmt(d.expense)}`);
      if (d.income > 0) parts.push(`received ${fmt(d.income)}`);
      if (d.upcoming.length > 0)
        parts.push(`${d.upcoming.length} payment${d.upcoming.length === 1 ? '' : 's'} due`);
      if (d.goalDeadlines.length > 0)
        parts.push(
          `${d.goalDeadlines.length} goal deadline${d.goalDeadlines.length === 1 ? '' : 's'}`,
        );
    } else parts.push('nothing recorded');
    return parts.join(', ');
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl">Calendar</h1>
          <p className="mt-1 text-muted">What happened, and what is coming, day by day.</p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => goMonth(addMonths(monthStart, -1))}
            aria-label="Previous month"
          >
            <ChevronLeft aria-hidden />
          </Button>
          <Button variant="secondary" size="sm" onClick={() => goMonth(today)}>
            Today
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => goMonth(addMonths(monthStart, 1))}
            aria-label="Next month"
          >
            <ChevronRight aria-hidden />
          </Button>
        </div>
      </div>

      <h2 className="mt-6 font-display text-2xl" aria-live="polite">
        {format(parseISO(monthStart), 'MMMM yyyy')}
      </h2>

      {query.isError && !query.data ? (
        <EmptyState
          className="mt-6"
          title="Couldn't load the calendar"
          description={`${query.error instanceof ApiError ? query.error.message : 'Check your connection.'} Your data is safe.`}
          action={<Button onClick={() => void query.refetch()}>Try again</Button>}
        />
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-3 gap-4 border-b border-rule pb-5">
            <Stat label="Spent">{query.data ? fmt(spent) : '…'}</Stat>
            <Stat label="Received">{query.data ? fmt(earned) : '…'}</Stat>
            <Stat label="Payments to come">{query.data ? dueCount : '…'}</Stat>
          </dl>

          <div
            role="grid"
            aria-label={`${format(parseISO(monthStart), 'MMMM yyyy')} calendar`}
            aria-busy={query.isFetching}
            className="mt-4"
          >
            <div role="row" className="grid grid-cols-7 text-center text-[0.75rem] text-muted">
              {WEEKDAYS.map((w) => (
                <div key={w} role="columnheader" className="py-1.5">
                  {w}
                </div>
              ))}
            </div>
            {query.isPending ? (
              <div role="status" aria-label="Loading calendar" className="grid grid-cols-7 gap-px">
                {cells.map((c) => (
                  <Skeleton key={c} className="h-14 w-full md:h-24" />
                ))}
              </div>
            ) : (
              Array.from({ length: weeks }, (_, w) => (
                <div role="row" key={w} className="grid grid-cols-7 gap-px">
                  {cells.slice(w * 7, w * 7 + 7).map((date) => {
                    const d = byDate.get(date);
                    const outside = date < monthStart || date > monthEnd;
                    const isSelected = date === selected;
                    return (
                      <div role="gridcell" key={date} aria-selected={isSelected}>
                        <button
                          type="button"
                          disabled={outside}
                          aria-label={label(date, d)}
                          aria-current={date === today ? 'date' : undefined}
                          onClick={() => go({ day: date })}
                          className={cn(
                            'flex h-14 w-full flex-col items-center gap-0.5 rounded-md border border-transparent px-0.5 py-1 text-[0.8125rem] transition-colors md:h-24 md:items-stretch md:px-2 md:py-1.5',
                            outside ? 'cursor-default opacity-30' : 'hover:bg-sunk',
                            isSelected && 'border-accent bg-accent-wash',
                            date === today && !isSelected && 'border-rule-strong',
                          )}
                        >
                          <span
                            className={cn(
                              'font-medium md:text-[0.875rem]',
                              date === today && 'text-accent',
                            )}
                          >
                            {Number(date.slice(8))}
                          </span>
                          {!outside && d ? (
                            <>
                              {/* Phones: small marks. Wider screens: the amounts themselves. */}
                              <span aria-hidden className="flex items-center gap-1 md:hidden">
                                {d.expense > 0 ? (
                                  <span className="size-1.5 rounded-full bg-loss" />
                                ) : null}
                                {d.income > 0 ? (
                                  <span className="size-1.5 rounded-full bg-gain" />
                                ) : null}
                                {d.upcoming.length > 0 ? (
                                  <span className="size-1.5 rounded-full border border-ink" />
                                ) : null}
                                {d.goalDeadlines.length > 0 ? (
                                  <span className="size-1.5 rotate-45 bg-ink" />
                                ) : null}
                              </span>
                              <span
                                aria-hidden
                                className="hidden flex-col gap-0.5 text-[0.75rem] md:flex"
                              >
                                {d.expense > 0 ? (
                                  <span className="truncate text-loss">−{fmt(d.expense)}</span>
                                ) : null}
                                {d.income > 0 ? (
                                  <span className="truncate text-gain">+{fmt(d.income)}</span>
                                ) : null}
                                {d.upcoming.length > 0 ? (
                                  <span className="flex items-center gap-1 truncate text-muted">
                                    <Repeat className="size-3 shrink-0" />
                                    {d.upcoming.length === 1
                                      ? d.upcoming[0]!.description
                                      : `${d.upcoming.length} due`}
                                  </span>
                                ) : null}
                                {d.goalDeadlines.length > 0 ? (
                                  <span className="flex items-center gap-1 truncate text-muted">
                                    <Target className="size-3 shrink-0" />
                                    {d.goalDeadlines[0]!.name}
                                  </span>
                                ) : null}
                              </span>
                            </>
                          ) : null}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[0.75rem] text-muted md:hidden">
            <span className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-loss" /> Spent
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-gain" /> Received
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full border border-ink" /> Payment due
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-1.5 rotate-45 bg-ink" /> Goal deadline
            </span>
          </p>

          <section aria-labelledby="day-title" className="mt-8 border-t border-rule pt-6">
            <h2 id="day-title" className="font-display text-xl">
              {format(parseISO(selected), 'EEEE, MMMM d')}
              {selected === today ? <Badge className="ml-2 align-middle">Today</Badge> : null}
            </h2>
            {!day ? (
              <p className="mt-2 text-muted">
                {selected > today
                  ? 'Nothing scheduled for this day.'
                  : 'No transactions on this day.'}{' '}
                <Link to="/transactions/new" className="font-medium text-accent hover:underline">
                  Add a transaction
                </Link>
              </p>
            ) : (
              <div className="mt-3 space-y-6">
                {day.transactions.length > 0 ? (
                  <div>
                    <h3 className="text-[0.8125rem] text-muted">Transactions</h3>
                    <ul className="mt-1 divide-y divide-rule">
                      {day.transactions.map((t) => (
                        <li key={t.id} className="flex items-baseline gap-3 py-2.5">
                          <Link
                            to={`/transactions/${t.id}/edit`}
                            className="min-w-0 flex-1 truncate hover:underline"
                          >
                            {t.description}
                          </Link>
                          {t.isRecurring ? <Badge>Recurring</Badge> : null}
                          <AmountText minor={t.amount} kind={t.type} currency={t.currency} />
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {day.upcoming.length > 0 ? (
                  <div>
                    <h3 className="text-[0.8125rem] text-muted">Due</h3>
                    <ul className="mt-1 divide-y divide-rule">
                      {day.upcoming.map((u) => (
                        <li key={u.ruleId} className="flex items-baseline gap-3 py-2.5">
                          <Link to="/recurring" className="min-w-0 flex-1 truncate hover:underline">
                            {u.description}
                          </Link>
                          <AmountText minor={u.amount} kind={u.type} currency={u.currency} />
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {day.goalDeadlines.length > 0 ? (
                  <div>
                    <h3 className="text-[0.8125rem] text-muted">Goal deadlines</h3>
                    <ul className="mt-1 divide-y divide-rule">
                      {day.goalDeadlines.map((g) => (
                        <li key={g.goalId} className="flex items-baseline gap-3 py-2.5">
                          <Link to="/goals" className="min-w-0 flex-1 truncate hover:underline">
                            {g.name}
                          </Link>
                          <span className="text-[0.875rem] text-muted">
                            {g.remaining > 0 ? `${fmt(g.remaining)} to go` : 'Reached'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
