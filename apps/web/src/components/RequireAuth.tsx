import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Button, EmptyState, Skeleton } from '@pfm/ui';
import { useSession } from '../lib/auth';

function FullPageStatus({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-lg px-6 py-24">{children}</div>;
}

/** Gate for everything that needs a signed-in user. */
export function RequireAuth() {
  const session = useSession();
  const location = useLocation();

  if (session.isPending) {
    return (
      <FullPageStatus>
        <div role="status" aria-label="Loading your account" className="space-y-4">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-4 w-52" />
        </div>
      </FullPageStatus>
    );
  }
  if (session.isError) {
    return (
      <FullPageStatus>
        <EmptyState
          title="We can't reach the server"
          description="Check your connection, then try again. Your data is safe."
          action={<Button onClick={() => void session.refetch()}>Try again</Button>}
        />
      </FullPageStatus>
    );
  }
  if (!session.data) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <Outlet />;
}

/** Sign-in / sign-up screens bounce signed-in users to the app. */
export function PublicOnly() {
  const session = useSession();
  const location = useLocation();
  if (session.isPending) return null;
  if (session.data) {
    // Honour the page that sent them to sign in; both this guard and the form's own redirect agree.
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from ?? '/'} replace />;
  }
  return <Outlet />;
}
