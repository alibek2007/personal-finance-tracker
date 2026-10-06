import { clickAndSave, expect, test } from '../support/fixtures';

test('a new user adds an account, records spending, and sees balances move', async ({
  page,
  user,
}) => {
  void user;
  await page.goto('/accounts');
  await page
    .getByRole('button', { name: /Add your first account|Add account/ })
    .first()
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill('Everyday');
  await dialog.getByLabel('Balance today').fill('1,000');
  await dialog
    .getByRole('button', { name: /^(Add|Create|Save)/ })
    .last()
    .click();
  await expect(page.getByText('Everyday').first()).toBeVisible();

  // Add an expense with the keyboard shortcut and the form.
  await page.keyboard.press('n');
  await expect(page.getByRole('heading', { level: 1, name: 'Add transaction' })).toBeVisible();
  await page.getByLabel('Amount', { exact: true }).fill('42.50');
  await page.getByLabel('Description').fill('Weekly groceries');
  await clickAndSave(page, page.getByRole('button', { name: 'Save expense' }));

  await page.goto('/transactions');
  const row = page.getByRole('row', { name: /Weekly groceries/ });
  await expect(row).toBeVisible();
  await expect(row).toContainText('42.50');

  await page.goto('/accounts');
  // $1,000.00 opening − $42.50, shown exactly, never as a rounded float.
  await expect(page.getByText('$957.50').first()).toBeVisible();
});

test('money is exact: cents add up with no floating-point drift', async ({ page, data }) => {
  const account = await data.account('Cash', 0, 'cash');
  for (const amount of [10, 20, 10, 10, 30]) {
    // 0.1 + 0.2 style amounts that break floats
    await data.transaction({ accountId: account.id, type: 'income', amount, description: 'Coin' });
  }
  await page.goto('/accounts');
  await expect(page.getByText('$0.80').first()).toBeVisible();
});

test('a transfer moves money between accounts without changing net worth', async ({
  page,
  data,
}) => {
  const checking = await data.account('Checking', 100_000);
  const savings = await data.account('Savings', 50_000, 'savings');
  await page.goto('/transactions/new');
  await page.getByRole('radio', { name: 'Move money' }).check({ force: true });
  await page.getByLabel('Amount leaving').fill('250');
  await page.getByLabel('From account').selectOption(checking.id);
  await page.getByLabel('To account').selectOption(savings.id);
  await page.getByLabel('Description').fill('Top up savings');
  await clickAndSave(page, page.getByRole('button', { name: 'Move money' }));

  await page.goto('/accounts');
  // $1,000 − $250 and $500 + $250: both accounts hold $750, and net worth is still $1,500.
  await expect(page.getByText('$750.00').nth(1)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Net worth' })).toContainText('$1,500');
});

test('editing and deleting a transaction keep balances consistent', async ({ page, data }) => {
  const account = await data.account('Checking', 100_000);
  const cats = await data.categories();
  await data.transaction({
    accountId: account.id,
    amount: 2_000,
    description: 'Lunch',
    categoryId: cats.Restaurants,
  });

  await page.goto('/transactions');
  await page.getByRole('link', { name: 'Lunch' }).click();
  await page.getByLabel('Amount', { exact: true }).fill('35');
  await clickAndSave(page, page.getByRole('button', { name: 'Save changes' }), 'PATCH');

  await page.goto('/accounts');
  await expect(page.getByText('$965.00').first()).toBeVisible();

  await page.goto('/transactions');
  await page
    .getByRole('button', { name: /Actions for Lunch/ })
    .first()
    .click();
  await page.getByRole('menuitem', { name: /Delete/ }).click();
  await page
    .getByRole('button', { name: /^Delete/ })
    .last()
    .click();
  await expect(page.getByText('Transaction deleted')).toBeVisible();

  await page.goto('/accounts');
  await expect(page.getByText('$1,000.00').first()).toBeVisible();
});

test('filters live in the URL, so a filtered view can be shared and survives reload', async ({
  page,
  data,
}) => {
  const account = await data.account('Checking', 0);
  await data.transaction({ accountId: account.id, description: 'Alpha purchase', amount: 500 });
  await data.transaction({ accountId: account.id, description: 'Beta purchase', amount: 700 });

  await page.goto('/transactions');
  await page.getByRole('searchbox', { name: 'Search transactions' }).fill('Beta');
  await expect(page).toHaveURL(/q=Beta/);
  await expect(page.getByRole('link', { name: 'Beta purchase' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Alpha purchase' })).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole('searchbox', { name: 'Search transactions' })).toHaveValue('Beta');
  await expect(page.getByRole('link', { name: 'Alpha purchase' })).toHaveCount(0);
});

test("one user's data is invisible to another", async ({ page, data, browser, baseURL }) => {
  const account = await data.account('Private', 12_345);
  await data.transaction({ accountId: account.id, description: 'Secret purchase' });

  const other = await browser.newContext({ baseURL });
  const otherPage = await other.newPage();
  const res = await otherPage.request.post('/api/auth/register', {
    data: {
      email: `e2e-other-${Date.now()}@example.com`,
      name: 'Other',
      password: 'correct horse battery staple',
    },
    headers: { 'x-requested-with': 'pfm', origin: baseURL! },
  });
  expect(res.ok()).toBe(true);
  await otherPage.goto('/transactions');
  await expect(otherPage.getByText('Secret purchase')).toHaveCount(0);
  const direct = await otherPage.request.get(`/api/accounts/${account.id}`);
  expect(direct.status()).toBe(404);
  await other.close();
  void page;
});
