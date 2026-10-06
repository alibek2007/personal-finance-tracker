import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { NotificationDto } from '@pfm/validation';
import { ledgerHandlers } from '../../test/fixtures';
import { mockApi, renderApp } from '../../test/utils';

afterEach(() => vi.restoreAllMocks());

// The dashboard is a lazy chunk; compile it once up front so a loaded machine cannot time a test out (preload the lazy screen).
beforeAll(async () => {
  await import('../dashboard/DashboardPage');
}, 60_000);

const note = (over: Partial<NotificationDto> & { id: string; title: string }): NotificationDto => ({
  type: 'budget_threshold',
  message: '$120 left until 2026-10-31.',
  isRead: false,
  createdAt: new Date(Date.now() - 3600_000).toISOString(),
  link: '/budgets',
  ...over,
});

const food = note({ id: 'n1', title: 'Food budget at 82%' });
const bill = note({
  id: 'n2',
  type: 'bill_due',
  title: 'Netflix is due tomorrow',
  message: '$15.99 will be recorded tomorrow.',
  link: '/recurring',
  isRead: true,
});

const feed = (items: NotificationDto[]) => ({
  ...ledgerHandlers(),
  'GET /notifications': (_body: unknown, ctx: { query: URLSearchParams }) => {
    const shown = ctx.query.get('unread') === 'true' ? items.filter((n) => !n.isRead) : items;
    return { json: { items: shown, unreadCount: items.filter((n) => !n.isRead).length } };
  },
  'GET /notifications/unread-count': () => ({
    json: { unreadCount: items.filter((n) => !n.isRead).length },
  }),
});

describe('notifications page', () => {
  it('lists notices with unread ones announced as such', async () => {
    mockApi(feed([food, bill]));
    renderApp('/notifications');
    const unread = await screen.findByRole('heading', { name: /Unread: Food budget at 82%/ });
    expect(unread).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Netflix is due tomorrow' })).toBeInTheDocument();
    expect(screen.getByText('1 unread')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'View' })[0]).toHaveAttribute('href', '/budgets');
  });

  it('marks one as read', async () => {
    const user = userEvent.setup();
    const items = [{ ...food }, { ...bill }];
    const calls = mockApi({
      ...feed(items),
      'PATCH /notifications/n1': () => {
        items[0]!.isRead = true; // the server remembers
        return { json: items[0] };
      },
    });
    renderApp('/notifications');
    await user.click(
      await screen.findByRole('button', { name: 'Mark "Food budget at 82%" as read' }),
    );
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ isRead: true }),
    );
    expect(
      await screen.findByRole('button', { name: 'Mark "Food budget at 82%" as unread' }),
    ).toBeInTheDocument();
  });

  it('marks everything read', async () => {
    const user = userEvent.setup();
    const items = [{ ...food }, { ...bill }];
    const calls = mockApi({
      ...feed(items),
      'POST /notifications/read-all': () => {
        items.forEach((n) => (n.isRead = true));
        return { json: { unreadCount: 0 } };
      },
    });
    renderApp('/notifications');
    await user.click(await screen.findByRole('button', { name: 'Mark all as read' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/notifications/read-all')).toBe(true));
    expect(await screen.findByText('All caught up')).toBeInTheDocument();
  });

  it('filters to unread and says so when there are none', async () => {
    const user = userEvent.setup();
    mockApi(feed([bill]));
    renderApp('/notifications');
    await screen.findByRole('heading', { name: 'Netflix is due tomorrow' });
    expect(screen.getByRole('button', { name: 'Mark all as read' })).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: 'Unread' }));
    expect(await screen.findByText("You're all caught up")).toBeInTheDocument();
  });

  it('explains an empty inbox', async () => {
    mockApi(feed([]));
    renderApp('/notifications');
    expect(await screen.findByText('No notifications yet')).toBeInTheDocument();
  });

  it('offers a retry when loading fails', async () => {
    const user = userEvent.setup();
    let up = false;
    mockApi({
      ...feed([food]),
      'GET /notifications': () =>
        up ? { json: { items: [food], unreadCount: 1 } } : { status: 500, json: {} },
    });
    renderApp('/notifications');
    expect(await screen.findByText("Couldn't load your notifications")).toBeInTheDocument();
    up = true;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: /Food budget/ })).toBeInTheDocument();
  });
});

describe('notification bell', () => {
  it('shows the unread count both visually and to screen readers', async () => {
    mockApi(feed([food, { ...food, id: 'n3', title: 'Another' }]));
    renderApp('/');
    const bell = await screen.findByRole('link', { name: 'Notifications, 2 unread' });
    expect(within(bell).getByText('2')).toBeInTheDocument();
  });

  it('is quiet when nothing is unread', async () => {
    mockApi(feed([bill]));
    renderApp('/');
    await screen.findByRole('main');
    await waitFor(() =>
      expect(screen.getAllByRole('link', { name: 'Notifications' })).toHaveLength(2),
    );
    expect(screen.queryByRole('link', { name: /unread/ })).not.toBeInTheDocument();
  });
});
