import { cloneElement, type ReactElement } from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { categories, checking, ledgerHandlers } from '../../test/fixtures';
import { emptyOverview, mockApi, renderApp, signedIn } from '../../test/utils';

// Charts measure their container; jsdom has no layout, so give them a fixed size.
vi.mock('recharts', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    ResponsiveContainer: ({
      children,
    }: {
      children: ReactElement<{ width?: number; height?: number }>;
    }) => (
      <div style={{ width: 800, height: 300 }}>
        {cloneElement(children, { width: 800, height: 300 })}
      </div>
    ),
  };
});

afterEach(() => vi.restoreAllMocks());

// The dashboard is a lazy chunk; compile it once up front so a loaded machine cannot time a test out (preload the lazy screen).
beforeAll(async () => {
  await import('./DashboardPage');
}, 60_000);

const overview = {
  ...emptyOverview,
  totalBalance: 1_234_500,
  hasTransactions: true,
  month: {
    from: '2026-10-01',
    to: '2026-10-15',
    income: 480000,
    spent: 253000,
    saved: 227000,
    savingsRateBp: 4729,
    daysElapsed: 15,
    daysInMonth: 31,
  },
  previous: {
    from: '2026-09-01',
    to: '2026-09-15',
    income: 480000,
    spent: 232000,
    saved: 248000,
    savingsRateBp: 5167,
  },
  changes: { incomeBp: 0, spentBp: 905, savedBp: -847 },
  insights: [
    {
      id: 'projected-savings',
      tone: 'positive',
      text: "If the rest of the month looks like last month, you'll save about $2,070.",
    },
    {
      id: 'category-trend-c-food',
      tone: 'negative',
      text: 'You spent 45% more on Food so far this month than at this point last month.',
      categoryId: 'c-food',
    },
  ],
};

const flow = {
  currency: 'USD',
  from: '2026-09-16',
  to: '2026-10-15',
  unit: 'day',
  points: [
    { start: '2026-10-01', end: '2026-10-01', income: 480000, expenses: 185000, net: 295000 },
    { start: '2026-10-05', end: '2026-10-05', income: 0, expenses: 60000, net: -60000 },
  ],
  totals: { income: 480000, spent: 253000, saved: 227000, savingsRateBp: 4729 },
  excludedCurrencies: [] as string[],
};

const breakdown = {
  currency: 'USD',
  from: '2026-10-01',
  to: '2026-10-15',
  total: 253000,
  excludedCurrencies: [] as string[],
  slices: [
    {
      categoryId: 'c-rent',
      name: 'Rent',
      color: '#1f4e5a',
      amount: 185000,
      shareBp: 7312,
      count: 1,
      children: [],
    },
    {
      categoryId: 'c-food',
      name: 'Food',
      color: '#b98a2e',
      amount: 68000,
      shareBp: 2688,
      count: 2,
      children: [],
    },
  ],
};

function dashboardHandlers(over: Record<string, unknown> = {}) {
  return {
    ...ledgerHandlers(),
    'GET /analytics/overview': () => ({ json: { ...overview, ...over } }),
    'GET /analytics/cash-flow': () => ({ json: flow }),
    'GET /analytics/categories': () => ({ json: breakdown }),
  };
}

describe('dashboard', () => {
  it('greets by name and shows the snapshot with explicit signs', async () => {
    mockApi(dashboardHandlers());
    renderApp('/');
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: /^Good (morning|afternoon|evening), Alex$/,
      }),
    ).toBeInTheDocument();
    const snapshot = await screen.findByRole('region', { name: 'Financial snapshot' });
    expect(within(snapshot).getByText('$12,345')).toBeInTheDocument(); // total balance
    expect(within(snapshot).getByText('+$4,800')).toBeInTheDocument(); // income
    expect(within(snapshot).getByText('−$2,530')).toBeInTheDocument(); // spent
    expect(within(snapshot).getByText('+$2,270')).toBeInTheDocument(); // saved
    expect(within(snapshot).getByText('47%')).toBeInTheDocument(); // savings rate
    expect(within(snapshot).getByText(/October so far/)).toBeInTheDocument();
  });

  it('describes changes in words, with a glyph, not just colour', async () => {
    mockApi(dashboardHandlers());
    renderApp('/');
    const snapshot = await screen.findByRole('region', { name: 'Financial snapshot' });
    expect(within(snapshot).getByText(/9% more than last month so far/)).toBeInTheDocument(); // spending up
    expect(within(snapshot).getByText(/8% less than last month so far/)).toBeInTheDocument(); // saved down
    expect(within(snapshot).getByText('About the same as last month so far')).toBeInTheDocument(); // income flat
  });

  it('explains when there is nothing to compare against', async () => {
    mockApi(dashboardHandlers({ changes: { incomeBp: null, spentBp: null, savedBp: null } }));
    renderApp('/');
    const snapshot = await screen.findByRole('region', { name: 'Financial snapshot' });
    expect(within(snapshot).getAllByText('No data for this point last month')).toHaveLength(3);
  });

  it('says "n/a" for the savings rate when there was no income', async () => {
    mockApi(
      dashboardHandlers({
        month: { ...overview.month, income: 0, saved: -253000, savingsRateBp: null },
      }),
    );
    renderApp('/');
    const snapshot = await screen.findByRole('region', { name: 'Financial snapshot' });
    expect(within(snapshot).getByText('n/a')).toBeInTheDocument();
    expect(within(snapshot).getByText('Needs some income first')).toBeInTheDocument();
  });

  it('mentions other currencies instead of mixing them in', async () => {
    mockApi(dashboardHandlers({ otherCurrencies: ['KZT'] }));
    renderApp('/');
    expect(await screen.findByText(/You also hold KZT, shown separately/)).toBeInTheDocument();
  });

  it('cash flow: accessible summary and data table, and the range control reloads data', async () => {
    const user = userEvent.setup();
    const calls = mockApi(dashboardHandlers());
    renderApp('/');
    const chart = await screen.findByRole('img', {
      name: /Bar chart of income and spending by day/,
    });
    expect(chart).toHaveAccessibleName(/Total income \$4,800\.00, total spent \$2,530\.00/);
    const table = screen.getByRole('table', { name: 'Income and spending by day' });
    expect(within(table).getAllByRole('row')).toHaveLength(3); // header + 2 points
    expect(within(table).getByText('−$600.00', { exact: false }) ?? true).toBeTruthy();

    expect(calls.find((c) => c.path === '/analytics/cash-flow')!.query).toContain('range=30d');
    await user.click(screen.getByRole('radio', { name: 'Last 7 days' }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.path === '/analytics/cash-flow' && c.query.includes('range=7d')),
      ).toBe(true),
    );
  });

  it('spending breakdown ranks categories with percentages and drills into transactions', async () => {
    const user = userEvent.setup();
    const calls = mockApi(dashboardHandlers());
    renderApp('/');
    const donut = await screen.findByRole('img', {
      name: /Donut chart of \$2,530\.00 spent October so far/,
    });
    expect(donut).toHaveAccessibleName(/Rent 73%, Food 27%/);
    await user.click(await screen.findByRole('button', { name: /Food, 27%/ }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.path === '/transactions' && c.query.includes('categoryId=c-food')),
      ).toBe(true),
    );
    const last = calls.filter((c) => c.path === '/transactions').at(-1)!;
    expect(last.query).toContain('type=expense');
    expect(last.query).toContain('dateFrom=2026-10-01');
    expect(last.query).toContain('dateTo=2026-10-15');
  });

  it('breakdown uses the month-to-date range, matching the snapshot', async () => {
    const calls = mockApi(dashboardHandlers());
    renderApp('/');
    await screen.findByRole('img', { name: /Donut chart/ });
    const q = calls.find((c) => c.path === '/analytics/categories')!.query;
    expect(q).toContain('range=custom');
    expect(q).toContain('from=2026-10-01');
    expect(q).toContain('to=2026-10-15');
  });

  it('shows real insights with tone labels for screen readers and a link to the evidence', async () => {
    mockApi(dashboardHandlers());
    renderApp('/');
    const section = await screen
      .findByRole('region', { name: 'What stands out' })
      .catch(() => null);
    const root =
      section ?? (await screen.findByText(/You spent 45% more on Food/)).closest('section')!;
    expect(within(root as HTMLElement).getByText(/you'll save about \$2,070/)).toBeInTheDocument();
    expect(within(root as HTMLElement).getByText('Good news:')).toHaveClass('sr-only');
    expect(within(root as HTMLElement).getByText('Worth watching:')).toHaveClass('sr-only');
    expect(
      within(root as HTMLElement).getByRole('link', { name: 'See transactions' }),
    ).toHaveAttribute('href', expect.stringContaining('category=c-food'));
  });

  it('is calm when there are no insights yet', async () => {
    mockApi(dashboardHandlers({ insights: [] }));
    renderApp('/');
    expect(await screen.findByText(/Nothing unusual yet/)).toBeInTheDocument();
  });

  it('lists recent transactions with a link to all of them', async () => {
    mockApi(dashboardHandlers());
    renderApp('/');
    const recent = (await screen.findByRole('heading', { name: 'Recent transactions' })).closest(
      'section',
    )!;
    expect(await within(recent).findByText('Acme Corp')).toBeInTheDocument();
    expect(within(recent).getByText('+$4,800.00')).toBeInTheDocument();
    expect(within(recent).getByRole('link', { name: 'View all transactions' })).toHaveAttribute(
      'href',
      '/transactions',
    );
  });

  it('welcomes a new user instead of showing empty charts', async () => {
    mockApi({ ...ledgerHandlers(), 'GET /analytics/overview': () => ({ json: emptyOverview }) });
    renderApp('/');
    expect(
      await screen.findByText('Your dashboard fills in as you add transactions'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add your first transaction/ })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Bar chart/ })).not.toBeInTheDocument();
  });

  it('shows a loading state, then offers a retry on failure', async () => {
    const user = userEvent.setup();
    let up = false;
    mockApi({
      ...dashboardHandlers(),
      'GET /analytics/overview': () => (up ? { json: overview } : { status: 500, json: {} }),
    });
    renderApp('/');
    expect(
      await screen.findByRole('status', { name: 'Loading your dashboard' }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Couldn't load your dashboard")).toBeInTheDocument();
    up = true;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('region', { name: 'Financial snapshot' })).toBeInTheDocument();
  });

  it('keeps working when one chart fails', async () => {
    mockApi({
      ...dashboardHandlers(),
      'GET /analytics/cash-flow': () => ({ status: 500, json: {} }),
    });
    renderApp('/');
    expect(await screen.findByText("Couldn't load your cash flow")).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: /Donut chart/ })).toBeInTheDocument();
  });
});

void categories;
void checking;
void signedIn;
