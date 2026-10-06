import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ledgerHandlers } from '../../test/fixtures';
import { mockApi, renderApp } from '../../test/utils';

afterEach(() => vi.restoreAllMocks());

const day12 = {
  date: '2026-10-12',
  income: 0,
  expense: 4500,
  transactions: [
    {
      id: 't1',
      type: 'expense',
      isRecurring: false,
      description: 'Starbucks',
      amount: 4500,
      currency: 'USD',
    },
  ],
  upcoming: [],
  goalDeadlines: [],
};
const day20 = {
  date: '2026-10-20',
  income: 0,
  expense: 0,
  transactions: [],
  upcoming: [
    { ruleId: 'r1', type: 'expense', description: 'Netflix', amount: 1599, currency: 'USD' },
  ],
  goalDeadlines: [{ goalId: 'g1', name: 'Laptop', remaining: 60000 }],
};

const calendar = (days: unknown[]) => ({
  ...ledgerHandlers(),
  'GET /calendar': () => ({
    json: { from: '2026-09-28', to: '2026-11-01', today: '2026-10-15', currency: 'USD', days },
  }),
});

describe('calendar page', () => {
  it('shows a month with each day described in words, not only colours', async () => {
    mockApi(calendar([day12, day20]));
    renderApp('/calendar?month=2026-10&day=2026-10-12');
    const grid = await screen.findByRole('grid', { name: 'October 2026 calendar' });
    expect(
      await within(grid).findByRole('button', {
        name: 'Monday, October 12, spent $45',
      }),
    ).toBeInTheDocument();
    expect(
      within(grid).getByRole('button', {
        name: 'Tuesday, October 20, 1 payment due, 1 goal deadline',
      }),
    ).toBeInTheDocument();
    expect(
      within(grid).getByRole('button', { name: 'Sunday, October 4, nothing recorded' }),
    ).toBeInTheDocument();
  });

  it('summarises the month', async () => {
    mockApi(calendar([day12, day20]));
    renderApp('/calendar?month=2026-10');
    const label = await screen.findByText('Payments to come');
    await waitFor(() => expect(label.closest('div')).toHaveTextContent('1'));
  });

  it('shows the selected day: transactions, what is due, goal deadlines', async () => {
    const user = userEvent.setup();
    mockApi(calendar([day12, day20]));
    renderApp('/calendar?month=2026-10&day=2026-10-12');
    const detail = await screen.findByRole('region', { name: /Monday, October 12/ });
    expect(await within(detail).findByRole('link', { name: 'Starbucks' })).toHaveAttribute(
      'href',
      '/transactions/t1/edit',
    );
    await user.click(await screen.findByRole('button', { name: /^Tuesday, October 20/ }));
    const next = await screen.findByRole('region', { name: /Tuesday, October 20/ });
    expect(within(next).getByRole('link', { name: 'Netflix' })).toBeInTheDocument();
    expect(within(next).getByText('$600 to go')).toBeInTheDocument();
  });

  it('moves between months and asks for the new range', async () => {
    const user = userEvent.setup();
    const calls = mockApi(calendar([]));
    renderApp('/calendar?month=2026-10');
    await screen.findByRole('grid', { name: 'October 2026 calendar' });
    await user.click(screen.getByRole('button', { name: 'Next month' }));
    expect(await screen.findByRole('grid', { name: 'November 2026 calendar' })).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/calendar' && c.query.includes('from=2026-10-26'))).toBe(
      true,
    );
    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(
      await screen.findByRole('grid', { name: 'September 2026 calendar' }),
    ).toBeInTheDocument();
  });

  it('offers a retry when loading fails', async () => {
    const user = userEvent.setup();
    let up = false;
    mockApi({
      ...ledgerHandlers(),
      'GET /calendar': () =>
        up
          ? {
              json: {
                from: '2026-09-28',
                to: '2026-11-01',
                today: '2026-10-15',
                currency: 'USD',
                days: [],
              },
            }
          : { status: 500, json: {} },
    });
    renderApp('/calendar?month=2026-10');
    expect(await screen.findByText("Couldn't load the calendar")).toBeInTheDocument();
    up = true;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('grid', { name: 'October 2026 calendar' })).toBeInTheDocument();
  });
});
