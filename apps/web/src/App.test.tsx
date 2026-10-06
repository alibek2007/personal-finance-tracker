import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockApi, renderApp, signedIn } from './test/utils';

beforeEach(() => {
  mockApi(signedIn());
});
afterEach(() => vi.restoreAllMocks());

// The dashboard is a lazy chunk; compile it once up front so a loaded machine cannot time a test out (preload the lazy screen).
beforeAll(async () => {
  await import('./features/dashboard/DashboardPage');
}, 60_000);

describe('app shell (signed in)', () => {
  it('provides landmarks and a skip link', async () => {
    renderApp('/');
    expect(await screen.findByRole('link', { name: 'Skip to content' })).toHaveAttribute(
      'href',
      '#main',
    );
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getAllByRole('navigation', { name: 'Main' }).length).toBeGreaterThan(0);
  });

  it('marks the current page in navigation', async () => {
    renderApp('/budgets');
    expect(await screen.findByRole('heading', { level: 1, name: 'Budgets' })).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: /budgets/i });
    expect(links.some((l) => l.getAttribute('aria-current') === 'page')).toBe(true);
  });

  it('exposes every destination in the navigation', async () => {
    renderApp('/');
    const nav = (await screen.findAllByRole('navigation', { name: 'Main' }))[0]!;
    for (const name of [
      'Dashboard',
      'Transactions',
      'Accounts',
      'Budgets',
      'Goals',
      'Analytics',
      'Recurring',
      'Calendar',
    ]) {
      expect(within(nav).getByRole('link', { name })).toBeInTheDocument();
    }
  });

  it('N opens Add transaction', async () => {
    const user = userEvent.setup();
    renderApp('/');
    await screen.findByRole('main');
    await user.keyboard('n');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Add transaction' }),
    ).toBeInTheDocument();
  });

  it('opens the command menu with / and navigates', async () => {
    const user = userEvent.setup();
    renderApp('/');
    await screen.findByRole('main');
    await user.keyboard('/');
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('combobox'), 'goals');
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { level: 1, name: 'Goals' })).toBeInTheDocument();
  });

  it('gives each screen its own title and moves focus to the new content', async () => {
    const user = userEvent.setup();
    renderApp('/');
    await screen.findByRole('main');
    await waitFor(() => expect(document.title).toBe('Dashboard · Ledger'));
    await user.keyboard('/');
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('combobox'), 'budgets');
    await user.keyboard('{Enter}');
    await screen.findByRole('heading', { level: 1, name: 'Budgets' });
    expect(document.title).toBe('Budgets · Ledger');
    expect(screen.getByRole('main')).toHaveFocus();
  });
});
