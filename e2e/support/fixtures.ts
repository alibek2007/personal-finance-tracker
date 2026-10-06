import { randomUUID } from 'node:crypto';
import {
  expect,
  test as base,
  type APIRequestContext,
  type Locator,
  type Page,
} from '@playwright/test';
import { DEMO_STATE } from '../global-setup';

export { expect };

export const PASSWORD = 'correct horse battery staple';

/** Headers the API requires on writes (CSRF marker and an allowed Origin). */
export const apiHeaders = (baseURL: string) => ({ 'x-requested-with': 'pfm', origin: baseURL });

/** Today in the demo user's timezone, which the browser is also set to. */
export const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

export interface Account {
  id: string;
  name: string;
}

/** Thin helpers over the API for arranging data quickly; the behaviour under test goes through the UI. */
export function arrange(request: APIRequestContext, baseURL: string) {
  const headers = apiHeaders(baseURL);
  const post = async <T = Record<string, unknown>>(path: string, data: unknown): Promise<T> => {
    const res = await request.post(`/api${path}`, { data, headers });
    if (!res.ok()) throw new Error(`POST ${path} failed: ${res.status()} ${await res.text()}`);
    return (await res.json()) as T;
  };
  return {
    post,
    account: (name: string, initialBalance = 100_000, type = 'bank') =>
      post<Account>('/accounts', { name, type, currency: 'USD', initialBalance }),
    async categories(): Promise<Record<string, string>> {
      const res = await request.get('/api/categories');
      const body = (await res.json()) as { categories: { id: string; name: string }[] };
      return Object.fromEntries(body.categories.map((c) => [c.name, c.id]));
    },
    transaction: (data: Record<string, unknown>) =>
      post('/transactions', {
        type: 'expense',
        description: 'Thing',
        amount: 1000,
        date: today(),
        ...data,
      }),
    get: async <T = unknown>(path: string): Promise<T> =>
      (await request.get(`/api${path}`)).json() as Promise<T>,
  };
}

interface Fixtures {
  /** A brand-new user (own data, nothing shared), already signed in in this page's browser context. */
  user: { email: string; name: string };
  /** Arrange data for the signed-in user through the API. */
  data: ReturnType<typeof arrange>;
}

export const test = base.extend<Fixtures>({
  user: async ({ page, baseURL }, use) => {
    const email = `e2e-${randomUUID().slice(0, 8)}@example.com`;
    const name = 'Test User';
    const res = await page.request.post('/api/auth/register', {
      data: { email, name, password: PASSWORD },
      headers: apiHeaders(baseURL!),
    });
    if (!res.ok()) throw new Error(`register failed: ${res.status()} ${await res.text()}`);
    await use({ email, name });
  },
  data: async ({ page, baseURL, user }, use) => {
    void user;
    await use(arrange(page.request, baseURL!));
  },
});

/** Runs a test as the seeded demo user (read-only tests: the demo ledger is shared). */
export const demo = base.extend({
  // An override of Playwright's own option, scoped to tests written with `demo` (not file-wide).
  // eslint-disable-next-line no-empty-pattern -- Playwright requires a destructured first argument
  storageState: async ({}, use) => {
    await use(DEMO_STATE);
  },
});

/** Waits for the page's loading skeletons to go away. */
export async function settled(page: Page) {
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByRole('status', { name: /Loading/ })).toHaveCount(0);
}

/** Clicks a button that saves through the API and waits for that save to finish (not just the click). */
export async function clickAndSave(
  page: Page,
  button: Locator,
  method: 'POST' | 'PATCH' | 'DELETE' = 'POST',
) {
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/api/') && r.request().method() === method && r.ok(),
    ),
    button.click(),
  ]);
}
