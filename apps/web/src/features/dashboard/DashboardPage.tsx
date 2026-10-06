import { Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { Button, EmptyState, Skeleton } from '@pfm/ui';
import { useOverview } from '../../lib/analytics';
import { useCurrentUser } from '../../lib/auth';
import { CashFlowChart } from './CashFlowChart';
import { Greeting, Snapshot } from './Snapshot';
import { BudgetsSection } from './BudgetsSection';
import { GoalsSection } from './GoalsSection';
import { UpcomingSection } from './UpcomingSection';
import { Insights, RecentTransactions } from './InsightsAndRecent';
import { SpendingBreakdown } from './SpendingBreakdown';

function DashboardSkeleton() {
  return (
    <div role="status" aria-label="Loading your dashboard" className="mt-8 space-y-8">
      <Skeleton className="h-16 w-72" />
      <div className="grid gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
      <Skeleton className="h-72 w-full" />
    </div>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const user = useCurrentUser();
  const overview = useOverview();
  const data = overview.data;

  return (
    <div>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <Greeting />
        {data ? <p className="text-muted">{format(parseISO(data.today), 'EEEE, MMMM d')}</p> : null}
      </header>

      {overview.isPending ? (
        <DashboardSkeleton />
      ) : overview.isError ? (
        <EmptyState
          className="mt-8"
          title="Couldn't load your dashboard"
          description="Check your connection and try again. Your data is safe."
          action={<Button onClick={() => void overview.refetch()}>Try again</Button>}
        />
      ) : !overview.data.hasTransactions ? (
        <>
          <Snapshot overview={overview.data} />
          <EmptyState
            title="Your dashboard fills in as you add transactions"
            description={`Record your first expense or paycheck and ${user.name.split(' ')[0] ?? 'you'} will see income, spending and where the money goes, right here.`}
            action={
              <Button onClick={() => navigate('/transactions/new')}>
                <Plus aria-hidden /> Add your first transaction
              </Button>
            }
          />
        </>
      ) : (
        <>
          <Snapshot overview={overview.data} />

          <div className="mt-10 grid gap-x-12 gap-y-12 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
            <CashFlowChart />
            <SpendingBreakdown
              from={overview.data.month.from}
              to={overview.data.month.to}
              periodLabel={`${format(parseISO(overview.data.month.from), 'MMMM')} so far`}
            />
          </div>

          <div className="mt-12 grid gap-x-12 gap-y-12 border-t border-rule pt-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
            <div className="space-y-12">
              <UpcomingSection />
              <BudgetsSection />
              <GoalsSection />
              <Insights overview={overview.data} />
            </div>
            <RecentTransactions />
          </div>
        </>
      )}
    </div>
  );
}
