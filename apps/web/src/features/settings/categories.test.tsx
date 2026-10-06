import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ledgerHandlers } from '../../test/fixtures';
import { mockApi, renderApp } from '../../test/utils';

afterEach(() => vi.restoreAllMocks());

describe('category manager (Settings)', () => {
  it('shows the tree: top-level categories with subcategories beneath', async () => {
    mockApi(ledgerHandlers());
    renderApp('/settings');
    const food = await screen.findByText('Food');
    expect(food).toBeInTheDocument();
    expect(screen.getByText('Coffee')).toBeInTheDocument();
    expect(screen.getByText('Groceries')).toBeInTheDocument();
    expect(screen.queryByText('Salary')).not.toBeInTheDocument(); // income is on the other tab
    await userEvent.setup().click(screen.getByRole('radio', { name: 'Income' }));
    expect(await screen.findByText('Salary')).toBeInTheDocument();
  });

  it('adds a subcategory under a parent', async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      ...ledgerHandlers(),
      'POST /categories': (body) => ({
        status: 201,
        json: {
          id: 'new',
          icon: 'tag',
          color: '#5b6b84',
          isDefault: false,
          isArchived: false,
          ...(body as object),
        },
      }),
    });
    renderApp('/settings');
    await user.click(await screen.findByRole('button', { name: /Add category/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Add category' });
    await user.type(within(dialog).getByLabelText('Name'), 'Pet care');
    await user.selectOptions(within(dialog).getByLabelText('Part of (optional)'), 'c-food');
    await user.click(within(dialog).getByRole('button', { name: 'Add category' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.path === '/categories')).toBe(true),
    );
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({
      name: 'Pet care',
      type: 'expense',
      parentId: 'c-food',
    });
  });

  it('shows a duplicate-name error from the server inside the dialog', async () => {
    const user = userEvent.setup();
    mockApi({
      ...ledgerHandlers(),
      'POST /categories': () => ({
        status: 409,
        json: {
          error: {
            code: 'category_exists',
            message: 'You already have a category called "Coffee" here.',
          },
        },
      }),
    });
    renderApp('/settings');
    await user.click(await screen.findByRole('button', { name: /Add category/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Add category' });
    await user.type(within(dialog).getByLabelText('Name'), 'Coffee');
    await user.click(within(dialog).getByRole('button', { name: 'Add category' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'already have a category called',
    );
  });

  it('archives a category without deleting its history', async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      ...ledgerHandlers(),
      'PATCH /categories/c-rent': (body) => ({
        json: {
          id: 'c-rent',
          name: 'Rent',
          type: 'expense',
          parentId: null,
          icon: 'tag',
          color: '#b98a2e',
          isDefault: true,
          isArchived: true,
          ...(body as object),
        },
      }),
    });
    renderApp('/settings');
    await user.click(await screen.findByRole('button', { name: 'Actions for Rent' }));
    await user.click(await screen.findByRole('menuitem', { name: /Archive/ }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ isArchived: true });
    expect(await screen.findByText('Rent archived')).toBeInTheDocument();
  });

  it('deleting a used category asks where its transactions should go', async () => {
    const user = userEvent.setup();
    let first = true;
    const calls = mockApi({
      ...ledgerHandlers(),
      'DELETE /categories/c-coffee': () => {
        if (first) {
          first = false;
          return {
            status: 409,
            json: {
              error: {
                code: 'has_transactions',
                message:
                  '4 transactions use this category. Choose where to move them, or archive the category instead.',
              },
            },
          };
        }
        return { json: { ok: true } };
      },
    });
    renderApp('/settings');
    await user.click(await screen.findByRole('button', { name: 'Actions for Coffee' }));
    await user.click(await screen.findByRole('menuitem', { name: /Delete/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete Coffee?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete category' }));
    expect(await within(dialog).findByText(/4 transactions use this category/)).toBeInTheDocument();
    const move = within(dialog).getByRole('button', { name: 'Move and delete' });
    expect(move).toBeDisabled(); // must choose a destination first
    await user.selectOptions(within(dialog).getByLabelText('Move those transactions to'), 'c-groc');
    await user.click(move);
    await waitFor(() => expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(2));
    expect(calls.filter((c) => c.method === 'DELETE')[1]!.query).toBe('reassignTo=c-groc');
  });
});
