import { randomUUID } from 'node:crypto';
import { request as pwRequest, expect, test as base } from '@playwright/test';
import { PASSWORD, apiHeaders, arrange, test } from '../support/fixtures';

const email = () => `e2e-${randomUUID().slice(0, 8)}@example.com`;

base(
  'writes without the CSRF marker, or from a foreign origin, are refused',
  async ({ baseURL }) => {
    const api = await pwRequest.newContext({ baseURL });
    const body = { email: email(), name: 'X', password: PASSWORD };

    const noMarker = await api.post('/api/auth/register', {
      data: body,
      headers: { origin: baseURL! },
    });
    expect(noMarker.status()).toBe(403);

    const foreign = await api.post('/api/auth/register', {
      data: body,
      headers: { 'x-requested-with': 'pfm', origin: 'https://evil.example' },
    });
    expect(foreign.status()).toBe(403);

    const ok = await api.post('/api/auth/register', { data: body, headers: apiHeaders(baseURL!) });
    expect(ok.status()).toBe(201);
    await api.dispose();
  },
);

base('every data route refuses a visitor who is not signed in', async ({ baseURL }) => {
  const api = await pwRequest.newContext({ baseURL });
  for (const path of [
    '/api/accounts',
    '/api/transactions',
    '/api/budgets',
    '/api/goals',
    '/api/recurring',
    '/api/notifications',
    '/api/calendar?from=2026-10-01&to=2026-10-31',
    '/api/search?q=x',
    '/api/export/transactions',
    '/api/analytics/overview',
  ]) {
    const res = await api.get(path);
    expect(res.status(), path).toBe(401);
  }
  await api.dispose();
});

base('the API sends hardening headers and does not advertise its stack', async ({ baseURL }) => {
  const api = await pwRequest.newContext({ baseURL });
  const res = await api.get('/api/health');
  const h = res.headers();
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['x-powered-by']).toBeUndefined();
  expect(h['content-security-policy'] ?? h['x-frame-options']).toBeDefined();
  await api.dispose();
});

test("a signed-in user cannot read, change or delete another user's records", async ({
  page,
  data,
  browser,
  baseURL,
}) => {
  const account = await data.account('Mine', 10_000);
  const cats = await data.categories();
  const tx = await data.transaction({ accountId: account.id, description: 'Mine only' });
  const budget = await data.post<{ id: string }>('/budgets', {
    categoryId: cats.Food,
    amount: 5_000,
  });
  const goal = await data.post<{ id: string }>('/goals', { name: 'Mine', targetAmount: 1_000 });
  const rule = await data.post<{ id: string }>('/recurring', {
    type: 'expense',
    accountId: account.id,
    amount: 500,
    description: 'Mine',
    frequency: 'monthly',
    nextOccurrence: new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10),
  });

  const intruderCtx = await browser.newContext({ baseURL });
  const intruder = arrange(intruderCtx.request, baseURL!);
  const reg = await intruderCtx.request.post('/api/auth/register', {
    data: { email: email(), name: 'Intruder', password: PASSWORD },
    headers: apiHeaders(baseURL!),
  });
  expect(reg.ok()).toBe(true);
  void intruder;
  const headers = apiHeaders(baseURL!);

  const attempts: [string, string, unknown?][] = [
    ['GET', `/api/accounts/${account.id}`],
    ['PATCH', `/api/accounts/${account.id}`, { name: 'Hacked' }],
    ['DELETE', `/api/accounts/${account.id}`],
    ['GET', `/api/transactions/${(tx as { id: string }).id}`],
    ['PATCH', `/api/transactions/${(tx as { id: string }).id}`, { description: 'Hacked' }],
    ['DELETE', `/api/transactions/${(tx as { id: string }).id}`],
    ['GET', `/api/budgets/${budget.id}`],
    ['DELETE', `/api/budgets/${budget.id}`],
    ['GET', `/api/goals/${goal.id}`],
    ['DELETE', `/api/goals/${goal.id}`],
    ['PATCH', `/api/recurring/${rule.id}`, { amount: 1 }],
    ['DELETE', `/api/recurring/${rule.id}`],
  ];
  for (const [method, path, body] of attempts) {
    const res = await intruderCtx.request.fetch(path, {
      method,
      headers,
      ...(body ? { data: body } : {}),
    });
    expect(res.status(), `${method} ${path}`).toBe(404);
  }

  // Posting into someone else's account is refused too, not silently accepted.
  const into = await intruderCtx.request.post('/api/transactions', {
    headers,
    data: {
      type: 'expense',
      accountId: account.id,
      amount: 100,
      description: 'x',
      date: '2026-10-01',
    },
  });
  expect(into.status()).toBe(400);

  // The owner's data is untouched.
  const still = await data.get<{ name: string }>(`/accounts/${account.id}`);
  expect(still.name).toBe('Mine');
  await intruderCtx.close();
  void page;
});

test('a session ends for real when you sign out: the old cookie is useless', async ({
  page,
  baseURL,
  user,
}) => {
  void user;
  const cookies = await page.context().cookies();
  const session = cookies.find((c) => c.name === 'pfm_session')!;
  await page.goto('/');
  await page.getByRole('button', { name: /Account menu/ }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();

  const replay = await pwRequest.newContext({
    baseURL,
    extraHTTPHeaders: { cookie: `pfm_session=${session.value}` },
  });
  expect((await replay.get('/api/me')).status()).toBe(401);
  expect((await replay.get('/api/accounts')).status()).toBe(401);
  await replay.dispose();
});

test('hostile text is shown as text, never run as script', async ({ page, data }) => {
  const account = await data.account('Checking', 0);
  let dialogs = 0;
  page.on('dialog', async (d) => {
    dialogs++;
    await d.dismiss();
  });
  await data.transaction({
    accountId: account.id,
    description: '<img src=x onerror="alert(1)">',
    merchant: '<script>alert(2)</script>',
    amount: 100,
  });
  await page.goto('/transactions');
  await expect(page.getByRole('link', { name: '<img src=x onerror="alert(1)">' })).toBeVisible();
  await page.goto('/');
  await page.waitForTimeout(500);
  expect(dialogs).toBe(0);
  expect(await page.locator('img[src="x"]').count()).toBe(0);
});
