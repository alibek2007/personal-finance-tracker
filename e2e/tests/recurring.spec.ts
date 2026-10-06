import { addDays } from '../support/dates';
import { clickAndSave, expect, test, today } from '../support/fixtures';

test('a payment due today is recorded as a real transaction, once', async ({ page, data }) => {
  const account = await data.account('Checking', 100_000);
  await page.goto('/recurring');
  await page
    .getByRole('button', { name: /Add your first one|Add recurring payment/ })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: 'Add a recurring payment' });
  await dialog.getByLabel('Name').fill('Netflix');
  await dialog.getByLabel('Amount', { exact: true }).fill('15.99');
  await dialog.getByLabel('Account').selectOption(account.id);
  await dialog.getByLabel('First payment').fill(today());
  await clickAndSave(page, dialog.getByRole('button', { name: 'Add payment' }));

  // It appears in the list with its next date a month away...
  await expect(page.getByRole('list', { name: 'Active recurring payments' })).toContainText(
    'Netflix',
  );
  // ...and today's payment already exists as a transaction, marked as recurring.
  await page.goto('/transactions');
  const row = page.getByRole('row', { name: /Netflix/ });
  await expect(row).toBeVisible();
  await expect(row).toContainText('Recurring');
  await expect(row).toContainText('15.99');

  // Reopening anything that triggers the job must not record it again.
  await page.goto('/recurring');
  await page.goto('/');
  await page.goto('/transactions');
  await expect(page.getByRole('row', { name: /Netflix/ })).toHaveCount(1);

  await page.goto('/accounts');
  await expect(page.getByText('$984.01').first()).toBeVisible();
});

test('subscriptions are totalled per month and per year, and pausing removes them from the totals', async ({
  page,
  data,
}) => {
  const account = await data.account('Checking', 100_000);
  const cats = await data.categories();
  const soon = addDays(today(), 10);
  for (const [description, amount] of [
    ['Netflix', 1599],
    ['Spotify', 1099],
  ] as const) {
    await data.post('/recurring', {
      type: 'expense',
      accountId: account.id,
      categoryId: cats.Subscriptions,
      amount,
      description,
      frequency: 'monthly',
      nextOccurrence: soon,
    });
  }

  await page.goto('/recurring');
  const summary = page.getByRole('region', { name: 'Recurring costs' });
  await expect(summary).toContainText('$26.98');
  await expect(summary).toContainText('$323.76');

  await clickAndSave(page, page.getByRole('button', { name: 'Pause Spotify' }), 'PATCH');
  await expect(summary).toContainText('$15.99');
  await expect(page.getByText('Paused').first()).toBeVisible();
});

test('the dashboard shows what is coming up, and a bill raises a notification a few days ahead', async ({
  page,
  data,
}) => {
  const account = await data.account('Checking', 100_000);
  await data.post('/recurring', {
    type: 'expense',
    accountId: account.id,
    amount: 5_000,
    description: 'Gym',
    frequency: 'monthly',
    nextOccurrence: addDays(today(), 2),
  });
  // The dashboard stays in its honest "nothing yet" state until there is a transaction to summarise.
  await data.transaction({ accountId: account.id, description: 'Coffee', amount: 450 });

  await page.goto('/');
  const coming = page.getByRole('region', { name: 'Coming up' });
  await expect(coming).toContainText('Gym');

  await page.goto('/notifications');
  await expect(page.getByRole('heading', { name: /Gym is due on/ })).toBeVisible();
});

test('a past first date is refused with an explanation instead of inventing history', async ({
  page,
  data,
}) => {
  const account = await data.account('Checking', 100_000);
  await page.goto('/recurring');
  await page
    .getByRole('button', { name: /Add your first one|Add recurring payment/ })
    .first()
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill('Old bill');
  await dialog.getByLabel('Amount', { exact: true }).fill('10');
  await dialog.getByLabel('Account').selectOption(account.id);
  await dialog.getByLabel('First payment').fill(addDays(today(), -5));
  await dialog.getByRole('button', { name: 'Add payment' }).click();
  await expect(dialog.getByText(/today or later/i).first()).toBeVisible();
});
