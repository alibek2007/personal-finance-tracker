import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ledgerHandlers } from '../../test/fixtures';
import { mockApi, renderApp } from '../../test/utils';

afterEach(() => vi.restoreAllMocks());

const CSV = 'Date,Description,Amount\n2026-10-01,Salary,3000.00\n2026-10-02,Coffee,-4.50\n';

const previewBody = (over: Record<string, unknown> = {}) => ({
  headers: ['Date', 'Description', 'Amount'],
  delimiter: ',',
  guessedMapping: { date: 0, description: 1, amount: 2 },
  mapping: { date: 0, description: 1, amount: 2 },
  currency: 'USD',
  rowCount: 2,
  counts: { ok: 2, duplicate: 0, error: 0 },
  totals: { income: 300000, expense: 450 },
  unmatchedCategories: [],
  rows: [
    {
      line: 2,
      status: 'ok',
      errors: [],
      date: '2026-10-01',
      type: 'income',
      amount: 300000,
      description: 'Salary',
      category: null,
    },
    {
      line: 3,
      status: 'ok',
      errors: [],
      date: '2026-10-02',
      type: 'expense',
      amount: 450,
      description: 'Coffee',
      category: null,
    },
  ],
  ...over,
});

async function openImport(user: ReturnType<typeof userEvent.setup>) {
  renderApp('/settings');
  await user.click(await screen.findByRole('button', { name: /Import from CSV/ }));
  return screen.findByRole('dialog', { name: 'Import transactions' });
}
const chooseFile = (dialog: HTMLElement, user: ReturnType<typeof userEvent.setup>, text = CSV) =>
  user.upload(
    within(dialog).getByLabelText('CSV file'),
    new File([text], 'bank.csv', { type: 'text/csv' }),
  );

describe('importing transactions', () => {
  it('previews the file before anything changes, then imports it', async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      ...ledgerHandlers(),
      'POST /import/transactions/preview': () => ({ json: previewBody() }),
      'POST /import/transactions': () => ({
        json: { imported: 2, skippedDuplicates: 0, skippedErrors: 0 },
      }),
    });
    const dialog = await openImport(user);
    expect(within(dialog).getByRole('button', { name: 'Import' })).toBeDisabled();
    await chooseFile(dialog, user);
    expect(await within(dialog).findByText(/will be imported/)).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/import/transactions')).toBe(false); // preview only so far
    expect(within(dialog).getByRole('row', { name: /Coffee/ })).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Import 2 transactions' }));
    expect(await within(dialog).findByText(/Imported/)).toBeInTheDocument();
    const post = calls.find((c) => c.method === 'POST' && c.path === '/import/transactions')!;
    expect(post.body).toMatchObject({
      csv: CSV,
      accountId: 'acc-chk',
      mapping: { date: 0, description: 1, amount: 2 },
      skipDuplicates: true,
    });
  });

  it('shows problems row by row and lets you skip duplicates', async () => {
    const user = userEvent.setup();
    mockApi({
      ...ledgerHandlers(),
      'POST /import/transactions/preview': () => ({
        json: previewBody({
          counts: { ok: 1, duplicate: 1, error: 1 },
          unmatchedCategories: ['Hobbies'],
          rows: [
            {
              line: 2,
              status: 'error',
              errors: ['"abc" is not a valid amount.'],
              date: '2026-10-01',
              type: null,
              amount: null,
              description: 'Broken',
              category: null,
            },
            {
              line: 3,
              status: 'duplicate',
              errors: [],
              date: '2026-10-02',
              type: 'expense',
              amount: 450,
              description: 'Coffee',
              category: null,
            },
            {
              line: 4,
              status: 'ok',
              errors: [],
              date: '2026-10-03',
              type: 'expense',
              amount: 100,
              description: 'Bus',
              category: null,
            },
          ],
        }),
      }),
    });
    const dialog = await openImport(user);
    await chooseFile(dialog, user);
    expect(await within(dialog).findByText(/"abc" is not a valid amount/)).toBeInTheDocument();
    expect(within(dialog).getByText(/1 already in Ledger/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Hobbies/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Import 1 transaction' })).toBeEnabled();
    await user.click(within(dialog).getByRole('checkbox', { name: /Skip the 1/ }));
    expect(within(dialog).getByRole('button', { name: 'Import 2 transactions' })).toBeEnabled();
  });

  it('asks which column is which when it cannot tell', async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      ...ledgerHandlers(),
      'POST /import/transactions/preview': (body) => {
        const b = body as { mapping?: unknown };
        return {
          json: b.mapping
            ? previewBody({ headers: ['a', 'b', 'c'], mapping: b.mapping })
            : previewBody({
                headers: ['a', 'b', 'c'],
                mapping: null,
                guessedMapping: {},
                rows: [],
                counts: { ok: 0, duplicate: 0, error: 0 },
              }),
        };
      },
    });
    const dialog = await openImport(user);
    await chooseFile(dialog, user, 'a,b,c\n2026-10-01,x,5');
    expect(
      await within(dialog).findByText('Tell Ledger which column is which'),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Import' })).toBeDisabled();
    await user.selectOptions(within(dialog).getByLabelText('Date'), '0');
    await user.selectOptions(within(dialog).getByLabelText('Description'), '1');
    await user.selectOptions(within(dialog).getByLabelText(/^Amount/), '2');
    await waitFor(() =>
      expect(
        calls.filter((c) => c.path === '/import/transactions/preview').at(-1)?.body,
      ).toMatchObject({ mapping: { date: 0, description: 1, amount: 2 } }),
    );
    expect(
      await within(dialog).findByRole('button', { name: 'Import 2 transactions' }),
    ).toBeEnabled();
  });

  it('says what is wrong with an unreadable file', async () => {
    const user = userEvent.setup();
    mockApi({
      ...ledgerHandlers(),
      'POST /import/transactions/preview': () => ({
        status: 400,
        json: { error: { code: 'invalid_csv', message: 'The file is empty.' } },
      }),
    });
    const dialog = await openImport(user);
    await chooseFile(dialog, user, ' ');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The file is empty.');
  });
});

describe('exporting transactions', () => {
  it('downloads the CSV and says so', async () => {
    const user = userEvent.setup();
    const createUrl = vi.fn(() => 'blob:ledger');
    Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: vi.fn() });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const calls = mockApi({
      ...ledgerHandlers(),
      'GET /export/transactions': () => ({ json: { csv: 'x' } }),
    });
    renderApp('/settings');
    await user.click(await screen.findByRole('button', { name: /Export all transactions/ }));
    expect(await screen.findByText('Your export is ready')).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/export/transactions')).toBe(true);
    expect(createUrl).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
  });

  it('exports exactly what the filters on the transactions page show', async () => {
    const user = userEvent.setup();
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:ledger'), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const calls = mockApi({
      ...ledgerHandlers(),
      'GET /export/transactions': () => ({ json: {} }),
    });
    renderApp('/transactions?type=expense&from=2026-09-01');
    await user.click(
      await screen.findByRole('button', { name: 'Export matching transactions as CSV' }),
    );
    await waitFor(() => expect(calls.some((c) => c.path === '/export/transactions')).toBe(true));
    const query = calls.find((c) => c.path === '/export/transactions')!.query;
    expect(query).toContain('type=expense');
    expect(query).toContain('dateFrom=2026-09-01');
    expect(query).not.toContain('page');
  });

  it('explains a failed export', async () => {
    const user = userEvent.setup();
    mockApi({
      ...ledgerHandlers(),
      'GET /export/transactions': () => ({ status: 429, json: {} }),
    });
    renderApp('/settings');
    await user.click(await screen.findByRole('button', { name: /Export all transactions/ }));
    expect(await screen.findByText(/exported a lot recently/)).toBeInTheDocument();
  });
});
