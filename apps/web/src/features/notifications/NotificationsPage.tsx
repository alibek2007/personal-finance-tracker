import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDistanceToNow, parseISO } from 'date-fns';
import {
  Bell,
  CalendarClock,
  CircleAlert,
  Target,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { Button, EmptyState, SegmentedControl, Skeleton, cn, toast } from '@pfm/ui';
import type { NotificationDto } from '@pfm/validation';
import { ApiError } from '../../lib/api';
import { useMarkAllRead, useNotifications, useSetRead } from '../../lib/notifications';

const ICONS: Record<NotificationDto['type'], LucideIcon> = {
  budget_threshold: TriangleAlert,
  budget_exceeded: CircleAlert,
  bill_due: CalendarClock,
  goal_progress: Target,
  spending_insight: Bell,
  system: Bell,
};

const VIEWS = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread' },
] as const;

function Row({ n }: { n: NotificationDto }) {
  const setRead = useSetRead();
  const Icon = ICONS[n.type];
  return (
    <li className="flex gap-4 py-4">
      <span
        aria-hidden
        className={cn(
          'mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full',
          n.isRead ? 'bg-sunk text-muted' : 'bg-accent-wash text-accent',
        )}
      >
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h2 className={cn('text-[0.9375rem]', n.isRead ? 'font-normal' : 'font-semibold')}>
            {!n.isRead ? <span className="sr-only">Unread: </span> : null}
            {n.title}
          </h2>
          <time dateTime={n.createdAt} className="text-[0.75rem] text-muted">
            {formatDistanceToNow(parseISO(n.createdAt), { addSuffix: true })}
          </time>
        </div>
        <p className="mt-0.5 text-[0.875rem] text-muted">{n.message}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {n.link ? (
            <Link
              to={n.link}
              onClick={() => {
                if (!n.isRead) setRead.mutate({ id: n.id, isRead: true });
              }}
              className="rounded-md px-2 py-1 text-[0.8125rem] font-medium text-accent hover:bg-accent-wash"
            >
              View
            </Link>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setRead.mutate({ id: n.id, isRead: !n.isRead })}
            aria-label={`Mark "${n.title}" as ${n.isRead ? 'unread' : 'read'}`}
          >
            Mark as {n.isRead ? 'unread' : 'read'}
          </Button>
        </div>
      </div>
    </li>
  );
}

export function NotificationsPage() {
  const [view, setView] = useState<'all' | 'unread'>('all');
  const query = useNotifications(view === 'unread');
  const markAll = useMarkAllRead();
  const unread = query.data?.unreadCount ?? 0;

  async function readAll() {
    try {
      await markAll.mutateAsync();
      toast.success('All caught up');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Couldn't do that. Try again.");
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl">Notifications</h1>
          <p className="mt-1 text-muted" aria-live="polite">
            {query.data ? (unread > 0 ? `${unread} unread` : 'Nothing unread') : ' '}
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={() => void readAll()}
          loading={markAll.isPending}
          disabled={unread === 0}
        >
          Mark all as read
        </Button>
      </div>

      <div className="mt-6">
        <SegmentedControl
          label="Show"
          options={VIEWS}
          value={view}
          onChange={(v) => setView(v as 'all' | 'unread')}
        />
      </div>

      {query.isPending ? (
        <div role="status" aria-label="Loading notifications" className="mt-6 space-y-4">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : query.isError ? (
        <EmptyState
          className="mt-8"
          title="Couldn't load your notifications"
          description={`${query.error instanceof ApiError ? query.error.message : 'Check your connection.'} Your data is safe.`}
          action={<Button onClick={() => void query.refetch()}>Try again</Button>}
        />
      ) : query.data.items.length === 0 ? (
        <EmptyState
          className="mt-8"
          title={view === 'unread' ? "You're all caught up" : 'No notifications yet'}
          description={
            view === 'unread'
              ? 'Nothing needs your attention right now.'
              : 'Ledger tells you when a budget is nearly used up or exceeded, a bill is coming due, or a goal is reached. Nothing has happened yet.'
          }
        />
      ) : (
        <ul className="mt-4 divide-y divide-rule border-t border-rule">
          {query.data.items.map((n) => (
            <Row key={n.id} n={n} />
          ))}
        </ul>
      )}
    </div>
  );
}
