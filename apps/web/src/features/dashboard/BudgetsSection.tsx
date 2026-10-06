import { Link } from 'react-router-dom';
import { Skeleton } from '@pfm/ui';
import type { BudgetDto } from '@pfm/validation';
import { useBudgets } from '../../lib/budgets';
import { BudgetRow } from '../budgets/BudgetsPage';

const SEVERITY: Record<BudgetDto['status'], number> = { over: 3, warning: 2, at_risk: 2, ok: 0 };
const SHOWN = 4;

/** The budgets that most need attention first, so the dashboard answers "am I on track?" at a glance. */
export function BudgetsSection() {
  const query = useBudgets();
  const active = query.data?.budgets.filter((b) => b.lifecycle === 'active') ?? [];
  const ranked = active
    .slice()
    .sort((a, b) => SEVERITY[b.status] - SEVERITY[a.status] || b.usedBp - a.usedBp)
    .slice(0, SHOWN);

  return (
    <section aria-labelledby="dash-budgets-title">
      <div className="flex items-baseline justify-between">
        <h2 id="dash-budgets-title" className="font-display text-xl">
          Budgets
        </h2>
        <Link to="/budgets" className="text-[0.875rem] font-medium text-accent hover:underline">
          {active.length > SHOWN ? `All ${active.length} budgets` : 'Manage budgets'}
        </Link>
      </div>
      {query.isPending ? (
        <div className="mt-3 space-y-4" role="status" aria-label="Loading budgets">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : query.isError ? (
        <p className="mt-3 text-muted">Couldn't load your budgets right now.</p>
      ) : ranked.length === 0 ? (
        <p className="mt-3 max-w-prose text-muted">
          Set a budget for a category like Food to see how much is left and get a warning before you
          go over.{' '}
          <Link to="/budgets" className="font-medium text-accent hover:underline">
            Set a budget
          </Link>
        </p>
      ) : (
        <ul className="mt-3 space-y-5">
          {ranked.map((b) => (
            <li key={b.id}>
              <BudgetRow budget={b} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
