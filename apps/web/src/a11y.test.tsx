import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ledgerHandlers } from './test/fixtures';
import { mockApi, renderApp, signedOut } from './test/utils';

afterEach(() => vi.restoreAllMocks());

// Compile the lazy screens once, up front, so a busy machine cannot time a test out.
beforeAll(async () => {
  await Promise.all([
    import('./features/dashboard/DashboardPage'),
    import('./features/analytics/AnalyticsPage'),
    import('./features/transactions/TransactionsPage'),
    import('./features/recurring/RecurringPage'),
    import('./features/calendar/CalendarPage'),
    import('./features/notifications/NotificationsPage'),
    import('./features/budgets/BudgetsPage'),
    import('./features/goals/GoalsPage'),
    import('./features/accounts/AccountsPage'),
    import('./pages/SettingsPage'),
    import('./pages/ProfilePage'),
  ]);
}, 90_000);

/**
 * Structural accessibility rules from axe-core: names, roles, labels, landmarks, ARIA validity, heading
 * and list structure. Colour contrast needs real layout, which jsdom does not have, so it is covered
 * separately by the design-token contrast test in packages/ui.
 */
async function violations(root: Element = document.body) {
  const result = await axe.run(root, {
    rules: {
      'color-contrast': { enabled: false },
      'scrollable-region-focusable': { enabled: false },
    },
    resultTypes: ['violations'],
  });
  return result.violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes.map((n) => n.html.slice(0, 140)).join('\n  ')}`,
  );
}

async function settled() {
  await screen.findByRole('main');
  await waitFor(() => expect(screen.queryAllByRole('status', { name: /Loading/ })).toHaveLength(0));
}

const handlers = () => ({
  ...ledgerHandlers(),
  'GET /recurring': () => ({
    json: {
      items: [
        {
          id: 'r1',
          type: 'expense',
          description: 'Netflix',
          amount: 1599,
          currency: 'USD',
          accountId: 'acc-chk',
          categoryId: null,
          frequency: 'monthly',
          interval: 1,
          cadence: 'Monthly',
          nextOccurrence: '2026-10-20',
          endDate: null,
          isActive: true,
          hasEnded: false,
          monthlyCost: 1599,
          yearlyCost: 19188,
          isSubscription: true,
          blocked: null,
        },
      ],
      totals: {
        currency: 'USD',
        activeCount: 1,
        monthlyExpenses: 1599,
        yearlyExpenses: 19188,
        monthlyIncome: 0,
        yearlyIncome: 0,
        subscriptionsMonthly: 1599,
        subscriptionsYearly: 19188,
        subscriptionsCount: 1,
      },
      excludedCurrencies: [],
    },
  }),
  'GET /notifications': () => ({
    json: {
      items: [
        {
          id: 'n1',
          type: 'bill_due',
          title: 'Netflix is due tomorrow',
          message: '$15.99 will be recorded tomorrow.',
          isRead: false,
          createdAt: '2026-10-05T10:00:00Z',
          link: '/recurring',
        },
      ],
      unreadCount: 1,
    },
  }),
  'GET /calendar': () => ({
    json: {
      from: '2026-09-28',
      to: '2026-11-01',
      today: '2026-10-15',
      currency: 'USD',
      days: [
        {
          date: '2026-10-20',
          income: 0,
          expense: 0,
          transactions: [],
          upcoming: [
            {
              ruleId: 'r1',
              type: 'expense',
              description: 'Netflix',
              amount: 1599,
              currency: 'USD',
            },
          ],
          goalDeadlines: [],
        },
      ],
    },
  }),
});

const SCREENS: [name: string, path: string][] = [
  ['Dashboard', '/'],
  ['Transactions', '/transactions'],
  ['Add transaction', '/transactions/new'],
  ['Accounts', '/accounts'],
  ['Budgets', '/budgets'],
  ['Goals', '/goals'],
  ['Analytics', '/analytics'],
  ['Recurring', '/recurring'],
  ['Calendar', '/calendar?month=2026-10'],
  ['Notifications', '/notifications'],
  ['Settings', '/settings'],
  ['Profile', '/profile'],
];

describe('accessibility (axe-core)', () => {
  it.each(SCREENS)('%s has no structural violations', async (_name, path) => {
    mockApi(handlers());
    renderApp(path);
    await settled();
    expect(await violations()).toEqual([]);
  });

  it.each([
    ['sign in', '/login'],
    ['create account', '/register'],
    ['forgot password', '/forgot-password'],
  ])('the %s page has no structural violations', async (_name, path) => {
    mockApi(signedOut);
    renderApp(path);
    await screen.findByRole('heading', { level: 1 });
    expect(await violations()).toEqual([]);
  });

  it('the add-recurring dialog, with its errors showing, has no violations', async () => {
    const user = userEvent.setup();
    mockApi(handlers());
    renderApp('/recurring');
    await user.click(await screen.findByRole('button', { name: /Add recurring payment/ }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Add payment' }));
    await within(dialog).findByText(/Give it a name/);
    expect(await violations()).toEqual([]);
  });

  it('the import dialog has no violations', async () => {
    const user = userEvent.setup();
    mockApi(handlers());
    renderApp('/settings');
    await user.click(await screen.findByRole('button', { name: /Import from CSV/ }));
    await screen.findByRole('dialog', { name: 'Import transactions' });
    expect(await violations()).toEqual([]);
  });

  it('the command menu has no violations', async () => {
    const user = userEvent.setup();
    mockApi(handlers());
    renderApp('/');
    await screen.findByRole('main');
    await user.keyboard('/');
    await screen.findByRole('dialog');
    expect(await violations()).toEqual([]);
  });
});
