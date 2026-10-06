import { cloneElement, type ReactElement } from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ledgerHandlers } from '../../test/fixtures';
import { mockApi, renderApp } from '../../test/utils';

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

// The page is lazy-loaded along with the charting library; compile it once, outside any test's clock.
beforeAll(async () => {
  await import('./AnalyticsPage');
}, 90_000);

afterEach(() => vi.restoreAllMocks());

const totals = (income: number, spent: number) => ({
  income,
  spent,
  saved: income - spent,
  savingsRateBp: income ? Math.round(((income - spent) * 10000) / income) : null,
});

const summary = {
  currency: 'USD',
  current: { from: '2026-09-16', to: '2026-10-15', ...totals(480000, 253000) },
  previous: { from: '2026-08-17', to: '2026-09-15', ...totals(480000, 232000) },
  changes: { incomeBp: 0, spentBp: 905, savedBp: -847 },
  dataStartsOn: '2026-01-01',
  excludedCurrencies: [] as string[],
};
const flow = {
  currency: 'USD',
  from: '2026-09-16',
  to: '2026-10-15',
  unit: 'week',
  points: [
    { start: '2026-09-28', end: '2026-10-04', income: 480000, expenses: 205000, net: 275000 },
    { start: '2026-10-05', end: '2026-10-11', income: 0, expenses: 48000, net: -48000 },
  ],
  totals: totals(480000, 253000),
  excludedCurrencies: [] as string[],
};
const categories = {
  currency: 'USD',
  from: '2026-09-16',
  to: '2026-10-15',
  total: 253000,
  excludedCurrencies: [] as string[],
  slices: [
    {
      categoryId: 'c-rent',
      name: 'Housing',
      color: '#1f4e5a',
      amount: 185000,
      shareBp: 7312,
      count: 1,
      children: [{ categoryId: 'c-rent', name: 'Rent', amount: 185000, count: 1 }],
    },
    {
      categoryId: 'c-food',
      name: 'Food',
      color: '#b98a2e',
      amount: 68000,
      shareBp: 2688,
      count: 3,
      children: [
        { categoryId: 'c-groc', name: 'Groceries', amount: 60000, count: 2 },
        { categoryId: 'c-coffee', name: 'Coffee', amount: 8000, count: 1 },
      ],
    },
  ],
};
const trend = {
  currency: 'USD',
  from: '2026-09-16',
  to: '2026-10-15',
  unit: 'week',
  excludedCurrencies: [] as string[],
  series: [
    { key: 'c-rent', name: 'Housing', color: '#1f4e5a' },
    { key: 'c-food', name: 'Food', color: '#b98a2e' },
  ],
  points: [
    {
      start: '2026-09-28',
      end: '2026-10-04',
      total: 205000,
      values: { 'c-rent': 185000, 'c-food': 20000 },
    },
    {
      start: '2026-10-05',
      end: '2026-10-11',
      total: 48000,
      values: { 'c-rent': 0, 'c-food': 48000 },
    },
  ],
};
const monthly = {
  currency: 'USD',
  excludedCurrencies: [] as string[],
  months: [
    {
      month: '2026-09',
      from: '2026-09-01',
      to: '2026-09-30',
      partial: false,
      ...totals(480000, 260000),
      incomeChangeBp: 0,
      spentChangeBp: 3000,
      savedChangeBp: -1000,
    },
    {
      month: '2026-10',
      from: '2026-10-01',
      to: '2026-10-15',
      partial: true,
      ...totals(480000, 253000),
      incomeChangeBp: 0,
      spentChangeBp: -500,
      savedChangeBp: null,
    },
  ],
};
const balances = {
  currency: 'USD',
  from: '2026-09-16',
  to: '2026-10-15',
  unit: 'week',
  excludedCurrencies: [] as string[],
  accounts: [
    { id: 'acc-chk', name: 'Checking', color: '#1f4e5a', type: 'bank' },
    { id: 'acc-visa', name: 'Visa', color: '#b2432b', type: 'credit_card' },
  ],
  points: [
    {
      date: '2026-10-04',
      total: 1_000_000,
      byAccount: { 'acc-chk': 1_082_000, 'acc-visa': -82000 },
    },
    {
      date: '2026-10-11',
      total: 1_040_000,
      byAccount: { 'acc-chk': 1_100_000, 'acc-visa': -60000 },
    },
  ],
};
const savings = {
  currency: 'USD',
  from: '2026-09-16',
  to: '2026-10-15',
  unit: 'week',
  points: [
    { date: '2026-10-04', total: 400000 },
    { date: '2026-10-11', total: 450000 },
  ],
  goals: [
    {
      id: 'g1',
      name: 'Emergency Fund',
      color: '#2e6b4b',
      current: 320000,
      target: 500000,
      progressBp: 6400,
    },
    {
      id: 'g2',
      name: 'Laptop',
      color: '#5b6b84',
      current: 130000,
      target: 200000,
      progressBp: 6500,
    },
  ],
};
const performance = {
  currency: 'USD',
  months: [
    { from: '2026-08-01', to: '2026-08-31', partial: false },
    { from: '2026-09-01', to: '2026-09-30', partial: false },
    { from: '2026-10-01', to: '2026-10-15', partial: true },
  ],
  budgets: [
    {
      id: 'b1',
      name: 'Food',
      limit: 50000,
      results: [
        { spent: 30000, over: false },
        { spent: 60000, over: true },
        { spent: 20000, over: false },
      ],
    },
    {
      id: 'b2',
      name: 'Shopping',
      limit: 10000,
      results: [null, { spent: 5000, over: false }, { spent: 0, over: false }],
    },
  ],
  monthsWithinBudget: 1,
  monthsEvaluated: 2,
};

function analyticsHandlers(over: Record<string, unknown> = {}) {
  return {
    ...ledgerHandlers(),
    'GET /analytics/summary': () => ({ json: summary }),
    'GET /analytics/cash-flow': () => ({ json: flow }),
    'GET /analytics/categories': () => ({ json: categories }),
    'GET /analytics/spending-trend': () => ({ json: trend }),
    'GET /analytics/monthly': () => ({ json: monthly }),
    'GET /analytics/balances': () => ({ json: balances }),
    'GET /analytics/savings': () => ({ json: savings }),
    'GET /analytics/budget-performance': () => ({ json: performance }),
    ...over,
  } as never;
}

const empty = (extra: object) => ({ json: extra });

describe('analytics page', () => {
  it('answers each question with its own chart, each with a written summary and a data table', async () => {
    mockApi(analyticsHandlers());
    renderApp('/analytics');
    for (const title of [
      'Am I earning more than I spend?',
      'Am I saving or spending down?',
      'Where does it go?',
      'How is my spending changing?',
      'How does this month compare?',
      'Is my net worth growing?',
      'Am I building my savings?',
      'Do I keep to my budgets?',
    ]) {
      expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument();
    }
    expect(
      await screen.findByRole('img', {
        name: /Bar chart of income and spending by week.*Total income \$4,800\.00, total spent \$2,530\.00/,
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Income and spending by week' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Net cash flow by week' })).toBeInTheDocument();
    expect(
      screen.getByRole('table', { name: 'Spending by week and category' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Balances over time' })).toBeInTheDocument();
  });

  it('summarises the range against the previous period, in words', async () => {
    mockApi(analyticsHandlers());
    renderApp('/analytics');
    const strip = await screen.findByRole('region', { name: 'Summary' });
    expect(within(strip).getByText('+$4,800')).toBeInTheDocument();
    expect(within(strip).getByText('−$2,530')).toBeInTheDocument();
    expect(within(strip).getByText(/9% more than the previous period/)).toBeInTheDocument();
    expect(within(strip).getByText(/8% less than the previous period/)).toBeInTheDocument();
    expect(within(strip).getByText('About the same as the previous period')).toBeInTheDocument();
    expect(within(strip).getByText('47%')).toBeInTheDocument();
  });

  it('ranks spending by category, expands to subcategories and links to the transactions', async () => {
    mockApi(analyticsHandlers());
    renderApp('/analytics');
    const section = (await screen.findByRole('heading', { name: 'Where does it go?' })).closest(
      'section',
    )!;
    const food = (await within(section).findByText('Food')).closest('details')!;
    expect(within(food).getByText('Groceries')).toBeInTheDocument();
    expect(within(food).getByText('Coffee')).toBeInTheDocument();
    const link = within(food).getByRole('link', { name: 'See these transactions' });
    expect(link.getAttribute('href')).toContain('category=c-food');
    expect(link.getAttribute('href')).toContain('type=expense');
    expect(link.getAttribute('href')).toContain('from=2026-09-16');
    expect(within(section).getByText('73%')).toBeInTheDocument();
  });

  it('shows month-by-month changes with a plain-language comparison', async () => {
    mockApi(analyticsHandlers());
    renderApp('/analytics');
    const section = (
      await screen.findByRole('heading', { name: 'How does this month compare?' })
    ).closest('section')!;
    const table = await within(section).findByRole('table', { name: 'Month by month' });
    expect(within(table).getByText(/30% more/)).toBeInTheDocument(); // the header already says "vs the month before"
    expect(within(table).getByText(/5% less than the same days last month/)).toBeInTheDocument();
    expect(within(table).getByText('so far')).toBeInTheDocument();
    expect(within(section).getByText(/Up to the last 12 months/)).toBeInTheDocument();
  });

  it('balance history reports the change and can show each account', async () => {
    const user = userEvent.setup();
    mockApi(analyticsHandlers());
    renderApp('/analytics');
    const section = (
      await screen.findByRole('heading', { name: 'Is my net worth growing?' })
    ).closest('section')!;
    expect(await within(section).findByText('$10,400')).toBeInTheDocument();
    expect(within(section).getByText('+$400')).toBeInTheDocument();
    await user.click(within(section).getByRole('button', { name: 'Show each account' }));
    expect(within(section).getAllByText('Checking').length).toBeGreaterThan(0);
    expect(
      within(section).getByRole('button', { name: 'Hide individual accounts' }),
    ).toBeInTheDocument();
  });

  it('savings progress lists each active goal', async () => {
    mockApi(analyticsHandlers());
    renderApp('/analytics');
    const section = (
      await screen.findByRole('heading', { name: 'Am I building my savings?' })
    ).closest('section')!;
    expect(
      await within(section).findByRole('progressbar', { name: 'Emergency Fund, 64% saved' }),
    ).toBeInTheDocument();
    expect(within(section).getByText(/\$3,200 of \$5,000/)).toBeInTheDocument();
  });

  it('budget performance marks each month in words as well as colour', async () => {
    mockApi(analyticsHandlers());
    renderApp('/analytics');
    const section = (
      await screen.findByRole('heading', { name: 'Do I keep to my budgets?' })
    ).closest('section')!;
    expect(await within(section).findByText('1 of 2')).toBeInTheDocument();
    expect(within(section).getByText(/over budget: \$600\.00 of \$500\.00/)).toBeInTheDocument();
    expect(within(section).getByText(/within budget: \$300\.00 of \$500\.00/)).toBeInTheDocument();
    expect(within(section).getAllByLabelText('No budget yet')).toHaveLength(1);
  });
});

describe('budget grid', () => {
  it('skips the leading months before any budget existed', async () => {
    mockApi(
      analyticsHandlers({
        'GET /analytics/budget-performance': () =>
          empty({
            ...performance,
            months: [
              { from: '2026-06-01', to: '2026-06-30', partial: false },
              ...performance.months,
            ],
            budgets: performance.budgets.map((b) => ({ ...b, results: [null, ...b.results] })),
          }),
      }),
    );
    renderApp('/analytics');
    const section = (
      await screen.findByRole('heading', { name: 'Do I keep to my budgets?' })
    ).closest('section')!;
    const table = await within(section).findByRole('table');
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(headers.some((h) => h?.startsWith('Jun'))).toBe(false);
    expect(headers.filter((h) => /^(Aug|Sep|Oct)/.test(h ?? ''))).toHaveLength(3);
  });
});

describe('filters', () => {
  it('sends the right filters to each endpoint, and only those that make sense for it', async () => {
    const calls = mockApi(analyticsHandlers());
    renderApp('/analytics?range=3m&account=acc-chk&category=c-food&type=expense');
    await screen.findByRole('heading', { name: 'Do I keep to my budgets?' });
    await waitFor(() => expect(calls.some((c) => c.path === '/analytics/savings')).toBe(true));
    const q = (path: string) => new URLSearchParams(calls.find((c) => c.path === path)!.query);

    for (const path of ['/analytics/summary', '/analytics/cash-flow']) {
      expect(Object.fromEntries(q(path))).toMatchObject({
        range: '3m',
        accountId: 'acc-chk',
        categoryId: 'c-food',
        type: 'expense',
      });
    }
    // spending views ignore the income/expense type
    for (const path of ['/analytics/categories', '/analytics/spending-trend']) {
      expect(Object.fromEntries(q(path))).toMatchObject({
        range: '3m',
        accountId: 'acc-chk',
        categoryId: 'c-food',
      });
      expect(q(path).has('type')).toBe(false);
    }
    // balances are about accounts, not categories or types
    expect(Object.fromEntries(q('/analytics/balances'))).toEqual({
      range: '3m',
      accountId: 'acc-chk',
    });
    // savings are about goals: only the date range applies
    expect(Object.fromEntries(q('/analytics/savings'))).toEqual({ range: '3m' });
    // monthly ignores the range but keeps the filters
    expect(Object.fromEntries(q('/analytics/monthly'))).toEqual({
      months: '12',
      accountId: 'acc-chk',
      categoryId: 'c-food',
      type: 'expense',
    });
  });

  it('changing the range reloads the data', async () => {
    const user = userEvent.setup();
    const calls = mockApi(analyticsHandlers());
    renderApp('/analytics');
    await screen.findByRole('region', { name: 'Summary' });
    await user.click(screen.getByRole('radio', { name: 'Last 7 days' }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.path === '/analytics/cash-flow' && c.query.includes('range=7d')),
      ).toBe(true),
    );
  });

  it('picking an account or type applies it, and "Clear filters" removes it', async () => {
    const user = userEvent.setup();
    const calls = mockApi(analyticsHandlers());
    renderApp('/analytics');
    await screen.findByRole('region', { name: 'Summary' });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Account' }), 'acc-sav');
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.path === '/analytics/cash-flow' && c.query.includes('accountId=acc-sav'),
        ),
      ).toBe(true),
    );
    await user.selectOptions(screen.getByLabelText('Type'), 'income');
    await waitFor(() =>
      expect(
        calls.some((c) => c.path === '/analytics/summary' && c.query.includes('type=income')),
      ).toBe(true),
    );
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
    expect((screen.getByRole('combobox', { name: 'Account' }) as HTMLSelectElement).value).toBe('');
  });

  it('a custom range waits for both dates before asking the server anything', async () => {
    const user = userEvent.setup();
    const calls = mockApi(analyticsHandlers());
    renderApp('/analytics');
    await screen.findByRole('region', { name: 'Summary' });
    const before = calls.filter((c) => c.path === '/analytics/cash-flow').length;
    await user.click(screen.getByRole('radio', { name: 'Custom date range' }));
    expect(
      await screen.findByText('Choose a start and end date to see your numbers.'),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText('From date'), '2026-09-01');
    expect(
      calls.filter((c) => c.path === '/analytics/cash-flow' && c.query.includes('custom')),
    ).toHaveLength(0);
    await user.type(screen.getByLabelText('To date'), '2026-09-30');
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.path === '/analytics/cash-flow' &&
            c.query.includes('range=custom') &&
            c.query.includes('from=2026-09-01') &&
            c.query.includes('to=2026-09-30'),
        ),
      ).toBe(true),
    );
    expect(calls.filter((c) => c.path === '/analytics/cash-flow').length).toBeGreaterThan(before);
  });

  it('refuses a custom range whose end is before its start', async () => {
    const calls = mockApi(analyticsHandlers());
    renderApp('/analytics?range=custom&from=2026-10-10&to=2026-10-01');
    expect(
      await screen.findByText('Choose a start and end date to see your numbers.'),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/analytics/cash-flow')).toBe(false);
  });
});

describe('resilience', () => {
  it('shows kind empty states when there is nothing yet', async () => {
    mockApi(
      analyticsHandlers({
        'GET /analytics/cash-flow': () =>
          empty({
            ...flow,
            points: flow.points.map((p) => ({ ...p, income: 0, expenses: 0, net: 0 })),
            totals: totals(0, 0),
          }),
        'GET /analytics/categories': () => empty({ ...categories, total: 0, slices: [] }),
        'GET /analytics/spending-trend': () => empty({ ...trend, series: [], points: [] }),
        'GET /analytics/balances': () => empty({ ...balances, accounts: [], points: [] }),
        'GET /analytics/savings': () => empty({ ...savings, goals: [], points: [] }),
        'GET /analytics/budget-performance': () =>
          empty({ ...performance, budgets: [], monthsEvaluated: 0, monthsWithinBudget: 0 }),
        'GET /analytics/monthly': () =>
          empty({
            ...monthly,
            months: monthly.months.map((m) => ({ ...m, income: 0, spent: 0, saved: 0 })),
          }),
      }),
    );
    renderApp('/analytics');
    expect(await screen.findByText('Nothing recorded in this period')).toBeInTheDocument();
    // both the category ranking and the over-time chart explain it
    expect(
      await screen.findAllByText('No spending in this range', { selector: 'h3' }),
    ).toHaveLength(2);
    expect(await screen.findByText('No accounts to show')).toBeInTheDocument();
    expect(await screen.findByText('No savings goals yet')).toBeInTheDocument();
    expect(await screen.findByText('No monthly budgets yet')).toBeInTheDocument();
    expect(await screen.findByText('No history yet')).toBeInTheDocument();
  });

  it('one failing chart does not take down the others', async () => {
    mockApi(analyticsHandlers({ 'GET /analytics/balances': () => ({ status: 500, json: {} }) }));
    renderApp('/analytics');
    const balance = (
      await screen.findByRole('heading', { name: 'Is my net worth growing?' })
    ).closest('section')!;
    expect(await within(balance).findByText("Couldn't load this chart")).toBeInTheDocument();
    expect(
      await screen.findByRole('img', { name: /Bar chart of income and spending by week/ }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('progressbar', { name: 'Emergency Fund, 64% saved' }),
    ).toBeInTheDocument();
  });

  it('warns when the previous period is only partly covered by the user’s records', async () => {
    mockApi(
      analyticsHandlers({
        'GET /analytics/summary': () => empty({ ...summary, dataStartsOn: '2026-09-01' }),
      }),
    );
    renderApp('/analytics');
    expect(
      await screen.findByText(
        /Your records start on Sep 1, 2026, so the previous period is only partly covered/,
      ),
    ).toBeInTheDocument();
  });

  it('says nothing about coverage when the records go back far enough', async () => {
    mockApi(analyticsHandlers());
    renderApp('/analytics');
    await screen.findByRole('region', { name: 'Summary' });
    expect(screen.queryByText(/Your records start on/)).not.toBeInTheDocument();
  });

  it('says plainly when another currency is left out', async () => {
    mockApi(
      analyticsHandlers({
        'GET /analytics/summary': () => empty({ ...summary, excludedCurrencies: ['KZT'] }),
      }),
    );
    renderApp('/analytics');
    expect(await screen.findByText(/KZT transactions are not included/)).toBeInTheDocument();
  });
});
