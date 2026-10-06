import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { alex, mockApi, renderApp, signedIn, signedOut } from './test/utils';

afterEach(() => vi.restoreAllMocks());

// The dashboard is a lazy chunk; compile it once up front so a loaded machine cannot time a test out (preload the lazy screen).
beforeAll(async () => {
  await import('./features/dashboard/DashboardPage');
}, 60_000);

const apiError = (status: number, code: string, message: string, details?: object) => ({
  status,
  json: { error: { code, message, ...(details ? { details } : {}) } },
});

describe('route protection', () => {
  it('sends signed-out visitors to sign in', async () => {
    mockApi(signedOut);
    renderApp('/transactions');
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
  });

  it('sends signed-in users away from the sign-in page', async () => {
    mockApi(signedIn());
    renderApp('/login');
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: /^Good (morning|afternoon|evening), Alex$/,
      }),
    ).toBeInTheDocument();
  });

  it('explains a server outage and offers a retry', async () => {
    const user = userEvent.setup();
    let up = false;
    mockApi({
      'GET /me': () => (up ? { json: { user: alex } } : { status: 503, json: {} }),
    });
    renderApp('/');
    expect(await screen.findByText("We can't reach the server")).toBeInTheDocument();
    up = true;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('main')).toBeInTheDocument();
  });
});

describe('sign in', () => {
  it('signs in and returns to the page that was requested', async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      ...signedOut,
      'POST /auth/login': () => ({ json: { user: alex } }),
    });
    renderApp('/budgets');
    await user.type(await screen.findByLabelText('Email'), 'alex@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Budgets' })).toBeInTheDocument();
    const login = calls.find((c) => c.path === '/auth/login')!;
    expect(login.body).toEqual({ email: 'alex@example.com', password: 'correct horse battery' });
    expect(login.headers['x-requested-with']).toBe('pfm'); // CSRF header on unsafe requests
  });

  it('validates before calling the server', async () => {
    const user = userEvent.setup();
    const calls = mockApi(signedOut);
    renderApp('/login');
    await user.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/auth/login')).toBe(false);
  });

  it('shows the server message for wrong credentials and keeps the form', async () => {
    const user = userEvent.setup();
    mockApi({
      ...signedOut,
      'POST /auth/login': () =>
        apiError(401, 'invalid_credentials', 'That email and password do not match.'),
    });
    renderApp('/login');
    await user.type(await screen.findByLabelText('Email'), 'alex@example.com');
    await user.type(screen.getByLabelText('Password'), 'nope');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That email and password do not match.',
    );
    expect(screen.getByLabelText('Email')).toHaveValue('alex@example.com');
  });

  it('tells the user when the network is down', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).endsWith('/me')) {
        return new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'x' } }), {
          status: 401,
        });
      }
      void init;
      throw new TypeError('offline');
    });
    renderApp('/login');
    await user.type(await screen.findByLabelText('Email'), 'alex@example.com');
    await user.type(screen.getByLabelText('Password'), 'whatever');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not reach the server/i);
  });
});

describe('register', () => {
  it('creates an account with detected timezone and chosen currency', async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      ...signedOut,
      'POST /auth/register': () => ({ status: 201, json: { user: alex } }),
    });
    renderApp('/register');
    await user.type(await screen.findByLabelText('Your name'), 'Alex Morgan');
    await user.type(screen.getByLabelText('Email'), 'alex@example.com');
    await user.type(screen.getByLabelText('Password'), 'a long passphrase here');
    await user.selectOptions(screen.getByLabelText('Main currency'), 'KZT');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: /^Good (morning|afternoon|evening), Alex$/,
      }),
    ).toBeInTheDocument();
    const body = calls.find((c) => c.path === '/auth/register')!.body as Record<string, string>;
    expect(body).toMatchObject({ name: 'Alex Morgan', currency: 'KZT' });
    expect(body.timezone).toBeTruthy();
  });

  it('rejects a short password client-side with a helpful message', async () => {
    const user = userEvent.setup();
    mockApi(signedOut);
    renderApp('/register');
    await user.type(await screen.findByLabelText('Your name'), 'Alex');
    await user.type(screen.getByLabelText('Email'), 'alex@example.com');
    await user.type(screen.getByLabelText('Password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Use at least 10 characters')).toBeInTheDocument();
  });

  it('explains a taken email', async () => {
    const user = userEvent.setup();
    mockApi({
      ...signedOut,
      'POST /auth/register': () =>
        apiError(
          409,
          'email_taken',
          'An account with this email already exists. Try signing in instead.',
        ),
    });
    renderApp('/register');
    await user.type(await screen.findByLabelText('Your name'), 'Alex');
    await user.type(screen.getByLabelText('Email'), 'alex@example.com');
    await user.type(screen.getByLabelText('Password'), 'a long passphrase here');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/already exists/i);
  });
});

describe('sign out', () => {
  it('ends the session and returns to sign in', async () => {
    const user = userEvent.setup();
    let signedInNow = true;
    const calls = mockApi({
      'GET /me': () =>
        signedInNow
          ? { json: { user: alex } }
          : apiError(401, 'unauthorized', 'Sign in to continue.'),
      'POST /auth/logout': () => {
        signedInNow = false;
        return { json: { ok: true } };
      },
    });
    renderApp('/');
    await user.click(await screen.findByRole('button', { name: 'Account menu for Alex Morgan' }));
    await user.click(await screen.findByRole('menuitem', { name: /sign out/i }));
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/auth/logout')).toBe(true);
  });
});

describe('password reset', () => {
  it('does not reveal whether the email has an account', async () => {
    const user = userEvent.setup();
    mockApi({ ...signedOut, 'POST /auth/password-reset/request': () => ({ json: { ok: true } }) });
    renderApp('/forgot-password');
    await user.type(await screen.findByLabelText('Email'), 'whoever@example.com');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/If an account exists/);
  });

  it('sets a new password from the emailed link and returns to sign in', async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      ...signedOut,
      'POST /auth/password-reset': () => ({ json: { ok: true } }),
    });
    renderApp('/reset-password?token=abcdefghijklmnopqrstuvwxyz');
    await user.type(await screen.findByLabelText('New password'), 'my second passphrase');
    await user.click(screen.getByRole('button', { name: 'Save new password' }));
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/Password updated/);
    expect(calls.find((c) => c.path === '/auth/password-reset')!.body).toEqual({
      token: 'abcdefghijklmnopqrstuvwxyz',
      password: 'my second passphrase',
    });
  });

  it('handles a link with no token', async () => {
    mockApi(signedOut);
    renderApp('/reset-password');
    expect(
      await screen.findByRole('heading', { name: 'This link is incomplete' }),
    ).toBeInTheDocument();
  });
});

describe('email verification link', () => {
  it('confirms exactly once even under StrictMode-style double effects', async () => {
    const calls = mockApi({
      ...signedOut,
      'POST /auth/verify-email': () => ({ json: { ok: true } }),
    });
    renderApp('/verify-email?token=abcdefghijklmnopqrstuvwxyz');
    expect(await screen.findByText(/your email is confirmed/i)).toBeInTheDocument();
    expect(calls.filter((c) => c.path === '/auth/verify-email')).toHaveLength(1);
  });

  it('shows the reason when the link is no good', async () => {
    mockApi({
      ...signedOut,
      'POST /auth/verify-email': () =>
        apiError(400, 'invalid_token', 'This confirmation link has expired or was already used.'),
    });
    renderApp('/verify-email?token=abcdefghijklmnopqrstuvwxyz');
    expect(await screen.findByText(/expired or was already used/)).toBeInTheDocument();
  });
});

describe('profile and settings', () => {
  it('shows verification status and can resend the link', async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      ...signedIn(),
      'POST /auth/verify-email/request': () => ({ json: { ok: true } }),
    });
    renderApp('/profile');
    expect(await screen.findByText('Not verified')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send confirmation link' }));
    await waitFor(() =>
      expect(calls.some((c) => c.path === '/auth/verify-email/request')).toBe(true),
    );
    expect(
      await screen.findByText(/Confirmation link sent to alex@example.com/),
    ).toBeInTheDocument();
  });

  it('maps a wrong current password onto its field', async () => {
    const user = userEvent.setup();
    mockApi({
      ...signedIn(),
      'POST /auth/change-password': () =>
        apiError(400, 'wrong_password', 'Your current password is not correct.', {
          currentPassword: ['Your current password is not correct.'],
        }),
    });
    renderApp('/profile');
    await user.type(await screen.findByLabelText('Current password'), 'not my password');
    await user.type(screen.getByLabelText('New password'), 'a brand new passphrase');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    const field = screen.getByLabelText('Current password');
    await waitFor(() => expect(field).toHaveAccessibleDescription(/not correct/));
  });

  it('saves currency and timezone changes', async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      ...signedIn(),
      'PATCH /me': (body) => ({ json: { user: { ...alex, ...(body as object) } } }),
    });
    renderApp('/settings');
    const save = await screen.findByRole('button', { name: 'Save changes' });
    expect(save).toBeDisabled(); // nothing changed yet
    await user.selectOptions(screen.getByLabelText('Main currency'), 'EUR');
    await user.click(save);
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({
      currency: 'EUR',
      timezone: 'UTC',
    });
    expect(await screen.findByText('Settings saved')).toBeInTheDocument();
  });

  it('switches theme from settings', async () => {
    const user = userEvent.setup();
    mockApi(signedIn());
    renderApp('/settings');
    await user.click(await screen.findByRole('radio', { name: 'Dark' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    const group = screen.getByRole('radiogroup', { name: 'Theme' });
    expect(within(group).getByRole('radio', { name: 'Dark' })).toBeChecked();
  });
});
