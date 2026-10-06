import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { ledgerHandlers } from '../../test/fixtures';
import { transactionsUrl } from '../../lib/search';
import { mockApi, renderApp } from '../../test/utils';

afterEach(() => vi.restoreAllMocks());

// The dashboard is a lazy chunk; compile it once up front so a loaded machine cannot time a test out (preload the lazy screen).
beforeAll(async () => {
  await import('../dashboard/DashboardPage');
}, 60_000);

const result = (over: Record<string, unknown> = {}) => ({
  query: 'x',
  understood: [],
  transactionFilter: { q: 'whole' },
  transactions: { total: 1, items: [] },
  accounts: [],
  categories: [],
  goals: [],
  recurring: [],
  ...over,
});
const wholeFoods = {
  id: 't-wf',
  type: 'expense',
  accountId: 'acc-chk',
  categoryId: null,
  amount: 8200,
  currency: 'USD',
  transferAccountId: null,
  transferAmount: null,
  isRefund: false,
  description: 'Whole Foods',
  merchant: null,
  date: '2026-09-20',
  notes: null,
  isRecurring: false,
  createdAt: '2026-09-20T10:00:00Z',
  categoryName: null,
};

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  renderApp('/');
  await screen.findByRole('main');
  await user.keyboard('/');
  const dialog = await screen.findByRole('dialog');
  return { dialog, input: within(dialog).getByRole('combobox') };
}

describe('global search', () => {
  it('shows matching transactions and other things, and says what it understood', async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      ...ledgerHandlers(),
      'GET /search': () => ({
        json: result({
          understood: ['expenses', 'over $50', 'last month'],
          transactionFilter: {
            type: 'expense',
            amountMin: '5001',
            dateFrom: '2026-09-01',
            dateTo: '2026-09-30',
          },
          transactions: { total: 9, items: [wholeFoods] },
          goals: [{ id: 'g1', name: 'Laptop' }],
        }),
      }),
    });
    const { dialog, input } = await openMenu(user);
    await user.type(input, 'expenses over $50 last month');
    expect(await within(dialog).findByText('Whole Foods')).toBeVisible();
    expect(
      within(dialog).getByText('Understood: expenses · over $50 · last month'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Sep 20 · $82.00')).toBeInTheDocument();
    expect(within(dialog).getByText('Laptop')).toBeVisible();
    expect(within(dialog).queryByText('Nothing matches that yet.')).not.toBeInTheDocument();
    expect(calls.some((c) => c.path === '/search' && c.query.includes('expenses%20over'))).toBe(
      true,
    );
  });

  it('opens the full, filtered list from "see all"', async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      ...ledgerHandlers(),
      'GET /search': () => ({
        json: result({
          understood: ['expenses', 'over $50'],
          transactionFilter: { type: 'expense', amountMin: '5001' },
          transactions: { total: 9, items: [wholeFoods] },
        }),
      }),
    });
    const { dialog, input } = await openMenu(user);
    await user.type(input, 'expenses over $50');
    await user.click(await within(dialog).findByText('See all 9 matching transactions'));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Transactions' }),
    ).toBeInTheDocument();
    // The list was asked for with the interpreted filters, from the URL.
    expect(
      calls.some(
        (c) =>
          c.path === '/transactions' &&
          c.query.includes('type=expense') &&
          c.query.includes('amountMin=5001'),
      ),
    ).toBe(true);
  });

  it('does not search for a single letter, and still navigates by name', async () => {
    const user = userEvent.setup();
    const calls = mockApi({ ...ledgerHandlers() });
    const { input } = await openMenu(user);
    await user.type(input, 'g');
    expect(calls.some((c) => c.path === '/search')).toBe(false);
  });

  it('keeps working when search fails', async () => {
    const user = userEvent.setup();
    mockApi({ ...ledgerHandlers(), 'GET /search': () => ({ status: 500, json: {} }) });
    const { dialog, input } = await openMenu(user);
    await user.type(input, 'goals');
    expect(await within(dialog).findByText('Goals')).toBeInTheDocument(); // the page link still works
  });
});

describe('transactionsUrl', () => {
  it('maps the interpreted filter onto the Transactions screen URL, amounts as decimals', () => {
    expect(
      transactionsUrl(
        {
          q: 'coffee',
          type: 'expense',
          categoryId: 'c1',
          dateFrom: '2026-09-01',
          dateTo: '2026-09-30',
          amountMin: '5001',
          amountMax: '10000',
        },
        'USD',
      ),
    ).toBe(
      '/transactions?q=coffee&type=expense&category=c1&from=2026-09-01&to=2026-09-30&min=50.01&max=100.00',
    );
  });
  it('is the plain list when nothing was interpreted', () => {
    expect(transactionsUrl({}, 'USD')).toBe('/transactions');
  });
});
