import { Link } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { useUnreadCount } from '../../lib/notifications';

/** Header shortcut to the notification page, with a count that is also spoken, not just shown. */
export function NotificationBell() {
  const { data } = useUnreadCount();
  const unread = data?.unreadCount ?? 0;
  return (
    <Link
      to="/notifications"
      aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
      className="relative inline-flex size-10 items-center justify-center rounded-md text-muted transition-colors hover:bg-sunk hover:text-ink"
    >
      <Bell aria-hidden className="size-[1.125rem]" />
      {unread > 0 ? (
        <span
          aria-hidden
          className="absolute right-1 top-1 flex min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[0.625rem] font-semibold leading-4 text-accent-ink"
        >
          {unread > 9 ? '9+' : unread}
        </span>
      ) : null}
    </Link>
  );
}
