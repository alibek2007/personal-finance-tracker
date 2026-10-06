import { Link } from 'react-router-dom';
import { addDays } from '@pfm/finance';
import { Skeleton } from '@pfm/ui';
import { AmountText, useFormatDay, useToday } from '../../components/LedgerBits';
import { useOccurrences } from '../../lib/recurring';

const WINDOW_DAYS = 14;
const SHOWN = 5;

/** The next two weeks of known bills and paychecks. */
export function UpcomingSection() {
  const today = useToday();
  const formatDay = useFormatDay();
  const query = useOccurrences(today, addDays(today, WINDOW_DAYS));
  const all = query.data?.occurrences ?? [];
  const shown = all.slice(0, SHOWN);

  return (
    <section aria-labelledby="dash-upcoming-title">
      <div className="flex items-baseline justify-between">
        <h2 id="dash-upcoming-title" className="font-display text-xl">
          Coming up
        </h2>
        <Link to="/recurring" className="text-[0.875rem] font-medium text-accent hover:underline">
          Manage recurring
        </Link>
      </div>
      {query.isPending ? (
        <div className="mt-3" role="status" aria-label="Loading upcoming payments">
          <Skeleton className="h-12 w-full" />
        </div>
      ) : query.isError ? (
        <p className="mt-3 text-muted">Couldn't load upcoming payments right now.</p>
      ) : shown.length === 0 ? (
        <p className="mt-3 max-w-prose text-muted">
          Nothing due in the next {WINDOW_DAYS} days.{' '}
          <Link to="/recurring" className="font-medium text-accent hover:underline">
            Add a bill or subscription
          </Link>{' '}
          and it will show up here.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-rule">
          {shown.map((o) => (
            <li key={`${o.ruleId}-${o.date}`} className="flex items-baseline gap-3 py-2.5">
              <span className="w-24 shrink-0 text-[0.8125rem] text-muted">{formatDay(o.date)}</span>
              <span className="min-w-0 flex-1 truncate">{o.description}</span>
              <AmountText minor={o.amount} kind={o.type} currency={o.currency} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
