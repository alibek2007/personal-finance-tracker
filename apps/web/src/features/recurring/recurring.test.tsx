import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { RecurringDto } from '@pfm/validation';
import { ledgerHandlers } from '../../test/fixtures';
import { emptyOverview, mockApi, renderApp } from '../../test/utils';

afterEach(() => vi.restoreAllMocks());

// The dashboard is a lazy chunk; compile it once up front so a loaded machine cannot time a test out (preload the lazy screen).
beforeAll(async () => {
  await import('../dashboard/DashboardPage');
}, 60_000);

const rule = (over: Partial<RecurringDto> & { id: string; description: string }): RecurringDto => ({
  type: 'expense',
  amount: 1599,
  currency: 'USD',
  accountId: 'acc-chk',
  categoryId: null,
  frequency: 'monthly',
  interval: 1,
  cadence: 'Monthly',
  nextOccurrence: '2026-09-20',
  endDate: null,
  isActive: true,
  hasEnded: false,
  monthlyCost: 1599,
  yearlyCost: 19188,
  isSubscription: true,
  blocked: null,
  ...over,
});

const netflix = rule({ id: 'nf', description: 'Netflix' });
const rent = rule({
  id: 'rent',
  description: 'Rent',
  amount: 120000,
  monthlyCost: 120000,
  yearlyCost: 1440000,
  isSubscription: false,
});
const gym = rule({ id: 'gym', description: 'Gym', isActive: false });

const totals = {
  currency: 'USD',
  activeCount: 2,
  monthlyExpenses: 121599,
  yearlyExpenses: 1459188,
  monthlyIncome: 0,
  yearlyIncome: 0,
  subscriptionsMonthly: 1599,
  subscriptionsYearly: 19188,
  subscriptionsCount: 1,
};

const withRules = (items: RecurringDto[], extra: Record<string, unknown> = {}) => ({
  ...ledgerHandlers(),
  'GET /recurring': () => ({
    json: { items, totals: items.length ? totals : null, excludedCurrencies: [] },
  }),
  ...extra,
});

describe('recurring page', () => {
  it('lists payments with their cadence and next date, and totals the subscriptions per year', async () => {
    mockApi(withRules([netflix, rent, gym]));
    renderApp('/recurring');
    const active = await screen.findByRole('list', { name: 'Active recurring payments' });
    expect(within(active).getByText('Netflix')).toBeInTheDocument();
    expect(within(active).getByText('Subscription')).toBeInTheDocument();
    expect(within(active).getAllByText(/Monthly · next/)).toHaveLength(2);
    expect(screen.getByText('Paused')).toBeInTheDocument();
    const summary = screen.getByRole('region', { name: 'Recurring costs' });
    expect(summary).toHaveTextContent('$1,215.99');
    expect(summary).toHaveTextContent('$191.88');
    expect(within(summary).getByText(/subscriptions cost approximately/)).toBeInTheDocument();
  });

  it('welcomes a user with none', async () => {
    mockApi(withRules([]));
    renderApp('/recurring');
    expect(await screen.findByText('No recurring payments yet')).toBeInTheDocument();
  });

  it('explains a payment that is on hold', async () => {
    mockApi(withRules([rule({ id: 'x', description: 'Hosting', blocked: 'account_archived' })]));
    renderApp('/recurring');
    expect(await screen.findByText(/Its account is archived/)).toBeInTheDocument();
  });

  it('offers a retry when loading fails', async () => {
    const user = userEvent.setup();
    let up = false;
    mockApi({
      ...withRules([netflix]),
      'GET /recurring': () =>
        up
          ? { json: { items: [netflix], totals, excludedCurrencies: [] } }
          : { status: 500, json: {} },
    });
    renderApp('/recurring');
    expect(await screen.findByText("Couldn't load your recurring payments")).toBeInTheDocument();
    up = true;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Netflix')).toBeInTheDocument();
  });

  it('pauses a payment', async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      ...withRules([netflix]),
      'PATCH /recurring/nf': () => ({ json: { ...netflix, isActive: false } }),
    });
    renderApp('/recurring');
    await user.click(await screen.findByRole('button', { name: 'Pause Netflix' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ isActive: false }),
    );
    expect(await screen.findByText('Netflix paused')).toBeInTheDocument();
  });

  it('asks before removing, then removes', async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      ...withRules([netflix]),
      'DELETE /recurring/nf': () => ({ json: { ok: true } }),
    });
    renderApp('/recurring');
    await user.click(await screen.findByRole('button', { name: 'Remove Netflix' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Yes, remove Netflix' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
  });
});

describe('adding a recurring payment', () => {
  it('sends exact minor units, the chosen schedule, and null for an empty end date', async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      ...withRules([]),
      'POST /recurring': () => ({ status: 201, json: netflix }),
    });
    renderApp('/recurring');
    await user.click(await screen.findByRole('button', { name: /Add your first one/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a recurring payment' });
    await user.type(within(dialog).getByLabelText('Name'), 'Netflix');
    await user.type(within(dialog).getByLabelText('Amount'), '15.99');
    await user.selectOptions(within(dialog).getByLabelText('Account'), 'acc-chk');
    await user.type(within(dialog).getByLabelText('First payment'), '2026-09-20');
    await user.click(within(dialog).getByRole('button', { name: 'Add payment' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({
      type: 'expense',
      description: 'Netflix',
      amount: 1599,
      accountId: 'acc-chk',
      frequency: 'monthly',
      interval: 1,
      nextOccurrence: '2026-09-20',
      endDate: null,
      categoryId: null,
    });
    expect(await screen.findByText('Netflix added')).toBeInTheDocument();
  });

  it('shows what is missing instead of submitting', async () => {
    const user = userEvent.setup();
    const calls = mockApi(withRules([]));
    renderApp('/recurring');
    await user.click(await screen.findByRole('button', { name: /Add your first one/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a recurring payment' });
    await user.click(within(dialog).getByRole('button', { name: 'Add payment' }));
    expect(await within(dialog).findByText(/Give it a name/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });
});

describe('dashboard', () => {
  it('lists what is coming up in the next two weeks', async () => {
    mockApi({
      ...withRules([netflix]),
      'GET /analytics/overview': () => ({ json: { ...emptyOverview, hasTransactions: true } }),
      'GET /recurring/occurrences': () => ({
        json: {
          occurrences: [
            {
              ruleId: 'nf',
              date: '2026-09-20',
              type: 'expense',
              description: 'Netflix',
              amount: 1599,
              currency: 'USD',
              accountId: 'acc-chk',
              categoryId: null,
            },
          ],
        },
      }),
    });
    renderApp('/');
    const section = await screen.findByRole('region', { name: 'Coming up' });
    expect(await within(section).findByText('Netflix')).toBeInTheDocument();
  });
});
