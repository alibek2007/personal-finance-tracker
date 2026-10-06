import { Link } from 'react-router-dom';
import { Skeleton } from '@pfm/ui';
import type { GoalDto } from '@pfm/validation';
import { useGoals } from '../../lib/goals';
import { GoalRow } from '../goals/GoalsPage';

const URGENCY: Record<GoalDto['status'], number> = {
  overdue: 3,
  behind: 2,
  on_track: 1,
  ahead: 1,
  no_deadline: 0,
  reached: 0,
};
const SHOWN = 3;

/** Goals needing the most attention first: overdue, then behind schedule, then by nearest deadline. */
export function GoalsSection() {
  const query = useGoals(false);
  const goals = (query.data?.goals ?? [])
    .filter((g) => !g.reached)
    .sort(
      (a, b) =>
        URGENCY[b.status] - URGENCY[a.status] ||
        (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999'),
    );
  const shown = goals.slice(0, SHOWN);

  return (
    <section aria-labelledby="dash-goals-title">
      <div className="flex items-baseline justify-between">
        <h2 id="dash-goals-title" className="font-display text-xl">
          Savings goals
        </h2>
        <Link to="/goals" className="text-[0.875rem] font-medium text-accent hover:underline">
          {goals.length > SHOWN ? `All ${goals.length} goals` : 'Manage goals'}
        </Link>
      </div>
      {query.isPending ? (
        <div className="mt-3 space-y-4" role="status" aria-label="Loading goals">
          <Skeleton className="h-12 w-full" />
        </div>
      ) : query.isError ? (
        <p className="mt-3 text-muted">Couldn't load your goals right now.</p>
      ) : shown.length === 0 ? (
        <p className="mt-3 max-w-prose text-muted">
          {query.data.goals.length > 0
            ? 'Every goal is reached or archived. Nice work.'
            : 'Saving for something? A goal shows how much to put aside each month.'}{' '}
          <Link to="/goals" className="font-medium text-accent hover:underline">
            {query.data.goals.length > 0 ? 'See your goals' : 'Create a goal'}
          </Link>
        </p>
      ) : (
        <ul className="mt-3 space-y-5">
          {shown.map((g) => (
            <li key={g.id}>
              <GoalRow goal={g} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
