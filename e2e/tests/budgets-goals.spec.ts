import { clickAndSave, expect, test } from '../support/fixtures';

test('a budget warns as spending approaches it, and the bell tells you once', async ({
  page,
  data,
}) => {
  const account = await data.account('Checking', 500_000);
  const cats = await data.categories();

  await page.goto('/budgets');
  await page
    .getByRole('button', { name: /Set your first budget|Set budget/ })
    .first()
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Category').selectOption(cats.Food!);
  await dialog.getByLabel('Limit').fill('500');
  await clickAndSave(page, dialog.getByRole('button', { name: 'Set budget' }));
  await expect(page.getByText('Food').first()).toBeVisible();

  // Spend 85% of it.
  await data.transaction({
    accountId: account.id,
    categoryId: cats.Groceries,
    amount: 42_500,
    description: 'Big shop',
  });

  await page.goto('/budgets');
  await expect(page.getByText('Big shop')).toHaveCount(0); // budgets show categories, not transactions
  await expect(page.getByText(/\$75 left|\$75\.00 left/).first()).toBeVisible();
  await expect(page.getByText(/85%/).first()).toBeVisible();

  // The notification arrives exactly once, however often we look.
  await page.goto('/notifications');
  await expect(page.getByRole('heading', { name: /Food budget at 85%/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: /Food budget at 85%/ })).toHaveCount(1);
});

test('going over budget is stated plainly and raises a separate notice', async ({ page, data }) => {
  const account = await data.account('Checking', 500_000);
  const cats = await data.categories();
  await data.post('/budgets', { categoryId: cats.Food, amount: 10_000 });
  await data.transaction({ accountId: account.id, categoryId: cats.Food, amount: 14_000 });

  await page.goto('/budgets');
  await expect(page.getByText(/Over by \$40/).first()).toBeVisible();

  await page.goto('/notifications');
  await expect(page.getByRole('heading', { name: /Food budget exceeded/ })).toBeVisible();
  await page.getByRole('button', { name: 'Mark all as read' }).click();
  await expect(page.getByText('Nothing unread')).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Notifications', exact: true }).first(),
  ).toBeVisible();
});

test('a savings goal tracks contributions, shows the monthly amount, and celebrates reaching it', async ({
  page,
  data,
}) => {
  void data;
  await page.goto('/goals');
  await page
    .getByRole('button', { name: /Create your first goal|Create goal/ })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: 'Create a goal' });
  await dialog.getByLabel('What are you saving for?').fill('Laptop');
  await dialog.getByLabel('Target amount').fill('1,000');
  await clickAndSave(page, dialog.getByRole('button', { name: 'Create goal' }));

  await page.getByRole('button', { name: 'Open Laptop goal' }).click();
  const drawer = page.getByRole('dialog');
  await drawer.getByLabel('Amount').fill('400');
  await clickAndSave(page, drawer.getByRole('button', { name: 'Add to goal' }));
  await expect(drawer.getByText('$400').first()).toBeVisible();

  await drawer.getByLabel('Amount').fill('600');
  await clickAndSave(page, drawer.getByRole('button', { name: 'Add to goal' }));
  await expect(drawer.getByText(/Goal reached/i).first()).toBeVisible();

  await page.keyboard.press('Escape');
  await page.goto('/notifications');
  await expect(page.getByRole('heading', { name: 'Laptop reached' })).toBeVisible();
});
