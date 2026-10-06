import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  categories,
  checking,
  ledgerHandlers,
  sampleTransactions,
  savings,
  tenge,
  tx,
  visa,
} from '../test/fixtures';
import { mockApi, renderApp } from '../test/utils';

afterEach(() => vi.restoreAllMocks());

const apiError = (status: number, code: string, message: string, details?: object) => ({
  status,
  json: { error: { code, message, ...(details ? { details } : {}) } },
});

describe('transactions list', () => {
  it('shows signed amounts so income and expenses never rely on colour', async () => {
    mockApi(ledgerHandlers());
    renderApp('/transactions');
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(within(rows[1]!).getByText('+$4,800.00')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('−$18.50')).toBeInTheDocument();
    // a transfer is neither income nor expense: unsigned, labelled, with both accounts
    expect(within(rows[3]!).getByText('$500.00')).toBeInTheDocument();
    expect(within(rows[3]!).getByText(/Checking → Savings/)).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Food › Coffee')).toBeInTheDocument();
    expect(await screen.findByText('3 transactions')).toBeInTheDocument();
  });

  it('explains an empty ledger and offers the next step', async () => {
    mockApi(ledgerHandlers({ transactions: [] }));
    renderApp('/transactions');
    expect(await screen.findByText("You haven't added any transactions yet")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add your first transaction/ })).toBeInTheDocument();
  });

  it('distinguishes "nothing matches" from "nothing yet"', async () => {
    mockApi(ledgerHandlers({ transactions: [] }));
    renderApp('/transactions?q=unicorn');
    expect(await screen.findByText('No transactions match these filters')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Clear filters' }).length).toBeGreaterThan(0);
  });

  it('sends filters to the API and keeps them in the URL', async () => {
    const user = userEvent.setup();
    const calls = mockApi(ledgerHandlers());
    renderApp('/transactions');
    await screen.findByRole('table');
    await user.type(screen.getByLabelText('Search transactions'), 'latte');
    await waitFor(() =>
      expect(calls.some((c) => c.path === '/transactions' && c.query.includes('q=latte'))).toBe(
        true,
      ),
    );
    await user.click(screen.getByRole('radio', { name: 'Expenses' }));
    await waitFor(() => expect(calls.some((c) => c.query.includes('type=expense'))).toBe(true));
    // the first-page request carries the default sort and page size
    const last = calls.filter((c) => c.path === '/transactions').at(-1)!;
    expect(last.query).toContain('sort=date');
    expect(last.query).toContain('pageSize=25');
  });

  it('converts the amount filter to exact minor units', async () => {
    const calls = mockApi(ledgerHandlers());
    renderApp('/transactions?min=100.50&max=2,000');
    await screen.findByRole('table');
    const q = calls.find((c) => c.path === '/transactions')!.query;
    expect(q).toContain('amountMin=10050');
    expect(q).toContain('amountMax=200000');
  });

  it('can sort by amount from the column header', async () => {
    const user = userEvent.setup();
    const calls = mockApi(ledgerHandlers());
    renderApp('/transactions');
    await user.click(await screen.findByRole('button', { name: /^Amount/ }));
    await waitFor(() => expect(calls.some((c) => c.query.includes('sort=amount'))).toBe(true));
  });

  it('deletes after confirmation and removes the row immediately', async () => {
    const user = userEvent.setup();
    let list = [...sampleTransactions];
    const calls = mockApi({
      ...ledgerHandlers(),
      'GET /transactions': () => ({
        json: { items: list, total: list.length, page: 1, pageSize: 25 },
      }),
      'DELETE /transactions/t2': () => {
        list = list.filter((t) => t.id !== 't2');
        return { json: { ok: true } };
      },
    });
    renderApp('/transactions');
    const table = await screen.findByRole('table');
    await user.click(within(table).getByRole('button', { name: 'Actions for Latte' }));
    await user.click(await screen.findByRole('menuitem', { name: /Delete/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/Checking will be adjusted|balance of Checking/);
    await user.click(within(dialog).getByRole('button', { name: 'Delete transaction' }));
    await waitFor(() =>
      expect(within(screen.getByRole('table')).queryByText('Latte')).not.toBeInTheDocument(),
    );
    expect(calls.some((c) => c.method === 'DELETE' && c.path === '/transactions/t2')).toBe(true);
    expect(await screen.findByText('Transaction deleted')).toBeInTheDocument();
  });

  it('rolls the row back and explains when the server refuses', async () => {
    const user = userEvent.setup();
    mockApi({
      ...ledgerHandlers(),
      'DELETE /transactions/t2': () =>
        apiError(503, 'unavailable', 'We hit a problem on our side. Try again in a moment.'),
    });
    renderApp('/transactions');
    const table = await screen.findByRole('table');
    await user.click(within(table).getByRole('button', { name: 'Actions for Latte' }));
    await user.click(await screen.findByRole('menuitem', { name: /Delete/ }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete transaction' }),
    );
    expect(await screen.findByText(/We hit a problem on our side/)).toBeInTheDocument();
    await waitFor(() =>
      expect(within(screen.getByRole('table')).getByText('Latte')).toBeInTheDocument(),
    );
  });

  it('assigns a category to the selected rows', async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      ...ledgerHandlers({
        transactions: [
          tx({ id: 'a', description: 'Coffee A' }),
          tx({ id: 'b', description: 'Coffee B' }),
        ],
      }),
      'POST /transactions/bulk-categorize': () => ({ json: { count: 2 } }),
    });
    renderApp('/transactions');
    const table = await screen.findByRole('table');
    await user.click(within(table).getByLabelText('Select all on this page'));
    expect(await screen.findByText('2 selected')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Set category for selected'), 'c-coffee');
    await waitFor(() =>
      expect(calls.some((c) => c.path === '/transactions/bulk-categorize')).toBe(true),
    );
    expect(calls.find((c) => c.path === '/transactions/bulk-categorize')!.body).toEqual({
      ids: ['a', 'b'],
      categoryId: 'c-coffee',
    });
    expect(await screen.findByText('Category updated on 2 transactions')).toBeInTheDocument();
  });

  it('offers a retry when loading fails', async () => {
    const user = userEvent.setup();
    let up = false;
    mockApi({
      ...ledgerHandlers(),
      'GET /transactions': () =>
        up
          ? { json: { items: sampleTransactions, total: 3, page: 1, pageSize: 25 } }
          : { status: 500, json: {} },
    });
    renderApp('/transactions');
    expect(await screen.findByText("Couldn't load your transactions")).toBeInTheDocument();
    up = true;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });
});

describe('add transaction', () => {
  async function fillAmount(user: ReturnType<typeof userEvent.setup>, amount: string) {
    await user.type(await screen.findByLabelText('Amount'), amount);
  }

  it('saves an expense in exact minor units, with the account currency', async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      ...ledgerHandlers(),
      'POST /transactions': (body) => ({
        status: 201,
        json: {
          ...(body as object),
          id: 'new',
          currency: 'USD',
          isRecurring: false,
          createdAt: '2026-10-05T00:00:00Z',
        },
      }),
    });
    renderApp('/transactions/new');
    await fillAmount(user, '12.50');
    await user.selectOptions(screen.getByLabelText('Category'), 'c-coffee');
    await user.type(screen.getByLabelText('Description'), 'Flat white');
    await user.click(screen.getByRole('button', { name: 'Save expense' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.path === '/transactions')).toBe(true),
    );
    const body = calls.find((c) => c.method === 'POST')!.body as Record<string, unknown>;
    expect(body).toMatchObject({
      type: 'expense',
      amount: 1250,
      categoryId: 'c-coffee',
      description: 'Flat white',
      accountId: 'acc-chk',
      transferAccountId: null,
    });
    expect(await screen.findByText('Expense saved')).toBeInTheDocument();
  });

  it('asks for an amount in plain language instead of posting', async () => {
    const user = userEvent.setup();
    const calls = mockApi(ledgerHandlers());
    renderApp('/transactions/new');
    await user.type(await screen.findByLabelText('Description'), 'Nothing');
    await user.click(screen.getByRole('button', { name: 'Save expense' }));
    expect(await screen.findByText('Enter an amount greater than zero')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('shows server field errors next to their fields', async () => {
    const user = userEvent.setup();
    mockApi({
      ...ledgerHandlers(),
      'POST /transactions': () =>
        apiError(400, 'validation_failed', 'Some fields need attention.', {
          accountId: ['That account is archived. Restore it or pick another.'],
        }),
    });
    renderApp('/transactions/new');
    await fillAmount(user, '5');
    await user.type(screen.getByLabelText('Description'), 'Lunch');
    await user.click(screen.getByRole('button', { name: 'Save expense' }));
    const field = await screen.findByRole('combobox', { name: 'Account' });
    await waitFor(() => expect(field).toHaveAccessibleDescription(/archived/));
  });

  it('a transfer between currencies asks what arrives', async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      ...ledgerHandlers({ accounts: [checking, tenge] }),
      'POST /transactions': (body) => ({
        status: 201,
        json: {
          ...(body as object),
          id: 'n',
          currency: 'USD',
          isRecurring: false,
          createdAt: '2026-10-05T00:00:00Z',
        },
      }),
    });
    renderApp('/transactions/new');
    await user.click(await screen.findByRole('radio', { name: 'Move money' }));
    expect(screen.queryByLabelText(/Amount arriving/)).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('To account'), 'acc-kzt');
    await user.type(screen.getByLabelText('Amount leaving'), '100');
    await user.type(await screen.findByLabelText(/Amount arriving \(KZT\)/), '47000');
    await user.type(screen.getByLabelText('Description'), 'Send home');
    await user.click(screen.getByRole('button', { name: 'Move money' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({
      type: 'transfer',
      amount: 10000,
      transferAccountId: 'acc-kzt',
      transferAmount: 4_700_000,
      categoryId: null,
    });
  });

  it('a same-currency transfer never asks for a second amount and credits the same sum', async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      ...ledgerHandlers(),
      'POST /transactions': (body) => ({
        status: 201,
        json: {
          ...(body as object),
          id: 'n',
          currency: 'USD',
          isRecurring: false,
          createdAt: '2026-10-05T00:00:00Z',
        },
      }),
    });
    renderApp('/transactions/new');
    await user.click(await screen.findByRole('radio', { name: 'Move money' }));
    await user.selectOptions(screen.getByLabelText('To account'), 'acc-sav');
    await user.type(screen.getByLabelText('Amount leaving'), '500');
    await user.type(screen.getByLabelText('Description'), 'Savings');
    expect(screen.queryByLabelText(/Amount arriving/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Move money' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({
      amount: 50000,
      transferAmount: 50000,
    });
  });

  it('one tap repeats a recent expense', async () => {
    const user = userEvent.setup();
    mockApi(
      ledgerHandlers({
        suggestions: [
          {
            type: 'expense',
            accountId: 'acc-sav',
            categoryId: 'c-coffee',
            description: 'Latte',
            merchant: 'Blue Bottle',
            count: 9,
          },
        ],
      }),
    );
    renderApp('/transactions/new');
    await user.click(await screen.findByRole('button', { name: /Latte.*Coffee.*Savings/ }));
    expect(screen.getByLabelText('Description')).toHaveValue('Latte');
    expect(screen.getByLabelText('Category')).toHaveValue('c-coffee');
    expect(screen.getByRole('combobox', { name: 'Account' })).toHaveValue('acc-sav');
    expect(screen.getByLabelText('Amount')).toHaveFocus();
  });

  it('guides someone with no accounts to add one first', async () => {
    mockApi(ledgerHandlers({ accounts: [] }));
    renderApp('/transactions/new');
    expect(await screen.findByText('Add an account first')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add your first account' })).toHaveAttribute(
      'href',
      '/accounts?new=1',
    );
  });

  it('editing loads the transaction and saves changes', async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      ...ledgerHandlers(),
      'GET /transactions/t2': () => ({ json: sampleTransactions[1] }),
      'PATCH /transactions/t2': (body) => ({
        json: { ...sampleTransactions[1], ...(body as object) },
      }),
    });
    renderApp('/transactions/t2/edit');
    const amount = await screen.findByLabelText('Amount');
    expect(amount).toHaveValue('18.50');
    await user.clear(amount);
    await user.type(amount, '19.25');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')!.body).toMatchObject({
      amount: 1925,
      description: 'Latte',
    });
  });
});

describe('accounts', () => {
  it('subtracts credit card debt from net worth and says what is owed', async () => {
    mockApi(ledgerHandlers());
    renderApp('/accounts');
    const region = await screen.findByRole('region', { name: 'Net worth' });
    // 4,320 + 8,500 - 820 = 12,000
    expect(within(region).getByText('$12,000')).toBeInTheDocument();
    expect(within(region).getByText('$12,820')).toBeInTheDocument(); // own
    expect(within(region).getByText('$820')).toBeInTheDocument(); // owe
    expect(screen.getByText('−$820.00')).toBeInTheDocument();
    expect(screen.getByText('owed')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Credit cards' })).toBeInTheDocument();
  });

  it('keeps other currencies separate instead of converting', async () => {
    mockApi(ledgerHandlers({ accounts: [checking, tenge] }));
    renderApp('/accounts');
    const region = await screen.findByRole('region', { name: 'Net worth' });
    expect(within(region).getByText('Net worth in USD')).toBeInTheDocument();
    expect(within(region).getByText(/rather than guessing an exchange rate/)).toBeInTheDocument();
  });

  it('welcomes a new user with no accounts', async () => {
    mockApi(ledgerHandlers({ accounts: [] }));
    renderApp('/accounts');
    expect(await screen.findByText("You haven't added any accounts yet")).toBeInTheDocument();
  });

  it('adds an account with an exact opening balance', async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      ...ledgerHandlers(),
      'POST /accounts': (body) => ({
        status: 201,
        json: {
          ...(body as object),
          id: 'new',
          currentBalance: (body as { initialBalance: number }).initialBalance,
          isArchived: false,
        },
      }),
    });
    renderApp('/accounts');
    await user.click(await screen.findByRole('button', { name: /Add account/ }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), 'Emergency fund');
    await user.selectOptions(within(dialog).getByLabelText('Type'), 'savings');
    await user.type(within(dialog).getByLabelText('Balance today'), '1,250.75');
    await user.click(within(dialog).getByRole('button', { name: 'Add account' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({
      name: 'Emergency fund',
      type: 'savings',
      currency: 'USD',
      initialBalance: 125075,
    });
  });

  it('accepts a negative balance for a credit card', async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      ...ledgerHandlers(),
      'POST /accounts': (body) => ({
        status: 201,
        json: { ...(body as object), id: 'new', currentBalance: -50000, isArchived: false },
      }),
    });
    renderApp('/accounts?new=1');
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), 'Amex');
    await user.selectOptions(within(dialog).getByLabelText('Type'), 'credit_card');
    await user.type(within(dialog).getByLabelText('Amount you owe today'), '-500');
    await user.click(within(dialog).getByRole('button', { name: 'Add account' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({
      type: 'credit_card',
      initialBalance: -50000,
    });
  });

  it('opens a drawer with recent activity and explains why an account with history cannot be deleted', async () => {
    const user = userEvent.setup();
    mockApi({
      ...ledgerHandlers(),
      'DELETE /accounts/acc-chk': () =>
        apiError(
          409,
          'has_transactions',
          'This account has 3 transactions. Archive it instead to keep your history intact.',
        ),
    });
    renderApp('/accounts');
    await user.click(await screen.findByRole('button', { name: /Checking/ }));
    const drawer = await screen.findByRole('dialog', { name: 'Checking' });
    expect(
      await within(drawer).findByText('Monthly savings (Checking → Savings)'),
    ).toBeInTheDocument();
    await user.click(within(drawer).getByRole('button', { name: /Delete/ }));
    const confirm = await screen.findByRole('dialog', { name: 'Delete Checking?' });
    await user.click(within(confirm).getByRole('button', { name: 'Delete account' }));
    expect(await screen.findByText(/Archive it instead/)).toBeInTheDocument();
  });

  it('shows archived accounts only on request', async () => {
    const user = userEvent.setup();
    mockApi(ledgerHandlers({ accounts: [checking, { ...savings, isArchived: true }] }));
    renderApp('/accounts');
    await screen.findByRole('region', { name: 'Net worth' });
    expect(screen.queryByText('Savings', { selector: 'span' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Show 1 archived account/ }));
    expect(screen.getByRole('button', { name: /Savings/ })).toBeInTheDocument();
  });
});

// keep the unused fixture imports honest
void categories;
void visa;
