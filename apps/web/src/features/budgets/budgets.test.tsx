import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BudgetDto } from '@pfm/validation';
import { ledgerHandlers } from '../../test/fixtures';
import { emptyOverview, mockApi, renderApp } from '../../test/utils';

afterEach(() => vi.restoreAllMocks());

const budget = (over: Partial<BudgetDto> & { id: string; categoryName: string }): BudgetDto => ({
  categoryId: `c-${over.id}`,
  categoryColor: '#b98a2e',
  parentCategoryName: null,
  amount: 50000,
  currency: 'USD',
  period: 'monthly',
  alertThreshold: 80,
  startDate: '2026-10-01',
  endDate: null,
  lifecycle: 'active',
  periodFrom: '2026-10-01',
  periodTo: '2026-10-31',
  spent: 20000,
  remaining: 30000,
  usedBp: 4000,
  elapsedBp: 4839,
  daysTotal: 31,
  daysElapsed: 15,
  daysRemaining: 16,
  projectedSpent: null,
  projectedOver: null,
  dailyAllowance: 1875,
  status: 'ok',
  headline: '$300 left',
  detail: 'About $19 a day for 16 more days.',
  ...over,
});

const food = budget({
  id: 'food',
  categoryName: 'Food',
  spent: 35000,
  remaining: 15000,
  usedBp: 7000,
  status: 'at_risk',
  projectedSpent: 72333,
  projectedOver: 22333,
  headline: '$150 left',
  detail: 'At your current pace, you may exceed this budget by $223.',
});
const shopping = budget({
  id: 'shop',
  categoryName: 'Shopping',
  amount: 20000,
  spent: 25000,
  remaining: -5000,
  usedBp: 12500,
  status: 'over',
  headline: 'Over by $50',
  detail: "You've used 125% of this budget.",
});
const coffee = budget({
  id: 'coffee',
  categoryName: 'Coffee',
  parentCategoryName: 'Food',
  amount: 5000,
  period: 'weekly',
  spent: 500,
  remaining: 4500,
  usedBp: 1000,
  periodFrom: '2026-10-12',
  periodTo: '2026-10-18',
  daysTotal: 7,
  headline: '$45 left',
  detail: 'About $9 a day for 4 more days.',
});

const withBudgets = (budgets: BudgetDto[]) => ({
  ...ledgerHandlers(),
  'GET /budgets': () => ({
    json: {
      budgets,
      monthly: (() => {
        const m = budgets.filter((b) => b.period === 'monthly' && b.lifecycle === 'active');
        return m.length
          ? {
              currency: 'USD',
              budgeted: m.reduce((s, b) => s + b.amount, 0),
              spent: m.reduce((s, b) => s + b.spent, 0),
              count: m.length,
            }
          : null;
      })(),
    },
  }),
});

describe('budgets page', () => {
  it('shows each budget with plain-language status, grouped by period', async () => {
    mockApi(withBudgets([food, shopping, coffee]));
    renderApp('/budgets');
    expect(await screen.findByRole('heading', { name: 'Monthly' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Weekly' })).toBeInTheDocument();

    const foodRow = screen.getByRole('button', { name: 'Edit Food budget' });
    expect(within(foodRow).getByText('$350 of $500')).toBeInTheDocument();
    expect(within(foodRow).getByText(/\$150 left/)).toBeInTheDocument();
    expect(
      within(foodRow).getByText('At your current pace, you may exceed this budget by $223.'),
    ).toBeInTheDocument();
    expect(
      within(foodRow).getByRole('progressbar', { name: 'Food budget, 70% used' }),
    ).toBeInTheDocument();

    const over = screen.getByRole('button', { name: 'Edit Shopping budget' });
    expect(within(over).getByText(/Over by \$50/)).toBeInTheDocument();
    expect(within(over).getByText('▲', { exact: false })).toBeInTheDocument(); // a glyph, not just colour

    expect(screen.getByRole('button', { name: 'Edit Food › Coffee budget' })).toBeInTheDocument();
  });

  it('puts the most-used budget first within a group', async () => {
    mockApi(withBudgets([food, shopping]));
    renderApp('/budgets');
    const rows = await screen.findAllByRole('button', { name: /^Edit .* budget$/ });
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual([
      'Edit Shopping budget',
      'Edit Food budget',
    ]);
  });

  it('summarises only the monthly budgets', async () => {
    mockApi(withBudgets([food, shopping, coffee]));
    renderApp('/budgets');
    const summary = await screen.findByRole('region', { name: 'Monthly summary' });
    expect(within(summary).getByText('Spent of 2 monthly budgets')).toBeInTheDocument();
    expect(within(summary).getByText('$600')).toBeInTheDocument(); // 350 + 250
    expect(within(summary).getByText(/\$700/)).toBeInTheDocument(); // 500 + 200
    expect(within(summary).getByText(/left across your monthly budgets/)).toBeInTheDocument();
  });

  it('welcomes a user with no budgets', async () => {
    mockApi(withBudgets([]));
    renderApp('/budgets');
    expect(await screen.findByText("You haven't set any budgets yet")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Set your first budget/ })).toBeInTheDocument();
  });

  it('lists budgets that have ended or not started yet separately', async () => {
    mockApi(
      withBudgets([
        food,
        budget({
          id: 'later',
          categoryName: 'Travel',
          lifecycle: 'upcoming',
          startDate: '2026-12-01',
        }),
        budget({ id: 'old', categoryName: 'Health', lifecycle: 'ended', endDate: '2026-09-30' }),
      ]),
    );
    renderApp('/budgets');
    const inactive = (await screen.findByRole('heading', { name: 'Not active' })).closest(
      'section',
    )!;
    expect(within(inactive).getByText('Starts Dec 1')).toBeInTheDocument();
    expect(within(inactive).getByText('Ended Sep 30')).toBeInTheDocument();
  });

  it('retries after a load failure', async () => {
    const user = userEvent.setup();
    let up = false;
    mockApi({
      ...withBudgets([food]),
      'GET /budgets': () =>
        up ? { json: { budgets: [food], monthly: null } } : { status: 500, json: {} },
    });
    renderApp('/budgets');
    expect(await screen.findByText("Couldn't load your budgets")).toBeInTheDocument();
    up = true;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Edit Food budget' })).toBeInTheDocument();
  });
});

describe('setting and editing a budget', () => {
  it('creates a monthly budget in exact minor units, with the spending average as a hint', async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      ...withBudgets([]),
      'GET /analytics/categories': () => ({
        json: {
          currency: 'USD',
          from: '2026-07-16',
          to: '2026-10-15',
          total: 150000,
          excludedCurrencies: [],
          slices: [
            {
              categoryId: 'c-food',
              name: 'Food',
              color: '#b98a2e',
              amount: 150000,
              shareBp: 10000,
              count: 40,
              children: [],
            },
          ],
        },
      }),
      'POST /budgets': (body) => ({
        status: 201,
        json: budget({
          id: 'new',
          categoryName: 'Food',
          amount: (body as { amount: number }).amount,
        }),
      }),
    });
    renderApp('/budgets');
    await user.click(await screen.findByRole('button', { name: /Set your first budget/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Set a budget' });
    await user.selectOptions(within(dialog).getByLabelText('Category'), 'c-food');
    expect(
      await within(dialog).findByText(/averaged about \$500 over the last 3 months/),
    ).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Limit'), '525.50');
    await user.click(within(dialog).getByRole('button', { name: 'Set budget' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.path === '/budgets')).toBe(true),
    );
    expect(calls.find((c) => c.method === 'POST' && c.path === '/budgets')!.body).toEqual({
      categoryId: 'c-food',
      amount: 52550,
      period: 'monthly',
      alertThreshold: 80,
    });
    expect(await screen.findByText('Budget set')).toBeInTheDocument();
  });

  it('asks for a category and an amount in plain language', async () => {
    const user = userEvent.setup();
    const calls = mockApi(withBudgets([]));
    renderApp('/budgets');
    await user.click(await screen.findByRole('button', { name: /Set your first budget/ }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Set budget' }));
    expect(await within(dialog).findAllByRole('alert')).not.toHaveLength(0);
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('shows the server’s explanation when a budget already exists', async () => {
    const user = userEvent.setup();
    mockApi({
      ...withBudgets([]),
      'POST /budgets': () => ({
        status: 409,
        json: {
          error: {
            code: 'budget_exists',
            message: 'You already have a monthly budget for this category. Edit that one instead.',
          },
        },
      }),
    });
    renderApp('/budgets');
    await user.click(await screen.findByRole('button', { name: /Set your first budget/ }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Category'), 'c-food');
    await user.type(within(dialog).getByLabelText('Limit'), '100');
    await user.click(within(dialog).getByRole('button', { name: 'Set budget' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Edit that one instead');
  });

  it('edits the limit and keeps the category fixed', async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      ...withBudgets([food]),
      'PATCH /budgets/food': (body) => ({ json: { ...food, ...(body as object) } }),
    });
    renderApp('/budgets');
    await user.click(await screen.findByRole('button', { name: 'Edit Food budget' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit Food budget' });
    expect(within(dialog).getByLabelText('Category')).toBeDisabled();
    const limit = within(dialog).getByLabelText('Limit');
    expect(limit).toHaveValue('500.00');
    await user.clear(limit);
    await user.type(limit, '600');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({
      amount: 60000,
      period: 'monthly',
      alertThreshold: 80,
    });
  });

  it('removing a budget needs a second confirming click', async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      ...withBudgets([food]),
      'DELETE /budgets/food': () => ({ json: { ok: true } }),
    });
    renderApp('/budgets');
    await user.click(await screen.findByRole('button', { name: 'Edit Food budget' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove budget' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false); // nothing yet
    await user.click(within(dialog).getByRole('button', { name: 'Yes, remove' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
    expect(await screen.findByText('Food budget removed')).toBeInTheDocument();
  });
});

describe('dashboard budgets', () => {
  const overview = { ...emptyOverview, hasTransactions: true, totalBalance: 100000 };

  it('shows the budgets needing attention first', async () => {
    mockApi({
      ...withBudgets([
        coffee,
        budget({ id: 'calm', categoryName: 'Transport', usedBp: 1000 }),
        food,
        shopping,
      ]),
      'GET /analytics/overview': () => ({ json: overview }),
      'GET /analytics/cash-flow': () => ({
        json: {
          currency: 'USD',
          from: '2026-09-16',
          to: '2026-10-15',
          unit: 'week',
          points: [],
          totals: { income: 0, spent: 0, saved: 0, savingsRateBp: null },
          excludedCurrencies: [],
        },
      }),
      'GET /analytics/categories': () => ({
        json: {
          currency: 'USD',
          from: '2026-10-01',
          to: '2026-10-15',
          total: 0,
          slices: [],
          excludedCurrencies: [],
        },
      }),
    });
    renderApp('/');
    const section = (await screen.findByRole('heading', { name: 'Budgets' })).closest('section')!;
    await within(section).findByText(/Over by \$50/);
    const bars = within(section).getAllByRole('progressbar');
    expect(bars[0]).toHaveAccessibleName(/Shopping budget, 125% used/); // over comes first
    expect(bars[1]).toHaveAccessibleName(/Food budget/); // then at risk
    expect(within(section).getByRole('link', { name: 'Manage budgets' })).toHaveAttribute(
      'href',
      '/budgets',
    );
  });

  it('nudges the user to set a first budget', async () => {
    mockApi({
      ...withBudgets([]),
      'GET /analytics/overview': () => ({ json: overview }),
      'GET /analytics/cash-flow': () => ({
        json: {
          currency: 'USD',
          from: '2026-09-16',
          to: '2026-10-15',
          unit: 'week',
          points: [],
          totals: { income: 0, spent: 0, saved: 0, savingsRateBp: null },
          excludedCurrencies: [],
        },
      }),
      'GET /analytics/categories': () => ({
        json: {
          currency: 'USD',
          from: '2026-10-01',
          to: '2026-10-15',
          total: 0,
          slices: [],
          excludedCurrencies: [],
        },
      }),
    });
    renderApp('/');
    expect(await screen.findByText(/Set a budget for a category like Food/)).toBeInTheDocument();
  });
});
