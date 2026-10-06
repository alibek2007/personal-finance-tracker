import { clickAndSave, expect, test } from '../support/fixtures';

/** The phone experience is designed, not just squeezed: bottom navigation, sheets, card lists. */

test('phones get a bottom bar and no sidebar', async ({ page, user }) => {
  void user;
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Main, mobile' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main', exact: true })).toBeHidden();
  await expect(page.getByRole('link', { name: 'Home' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Activity' })).toBeVisible();
});

test('the More sheet reaches every other screen', async ({ page, user }) => {
  void user;
  await page.goto('/');
  await page.getByRole('button', { name: 'More' }).click();
  const more = page.getByRole('dialog');
  for (const name of [
    'Accounts',
    'Budgets',
    'Goals',
    'Recurring',
    'Calendar',
    'Notifications',
    'Settings',
  ]) {
    await expect(more.getByRole('link', { name })).toBeVisible();
  }
  await more.getByRole('link', { name: 'Budgets' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Budgets' })).toBeVisible();
});

test('adding a transaction one-handed: the big + button, a bottom-sheet-friendly form, saved', async ({
  page,
  data,
}) => {
  await data.account('Checking', 100_000);
  await page.goto('/');
  await page.getByRole('link', { name: /Add transaction/ }).click();
  await expect(page.getByLabel('Amount', { exact: true })).toBeFocused();
  await page.getByLabel('Amount', { exact: true }).fill('7.25');
  await page.getByLabel('Description').fill('Coffee');
  await clickAndSave(page, page.getByRole('button', { name: 'Save expense' }));

  await page.goto('/transactions');
  // On a phone the list is cards grouped by day, not a wide table.
  await expect(page.getByRole('table')).toHaveCount(0);
  await expect(page.getByText('Coffee').locator('visible=true').first()).toBeVisible();
});

test('dialogs rise from the bottom like a sheet and stay within the screen', async ({
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
  await expect(dialog).toBeVisible();
  const box = (await dialog.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  // Anchored to the bottom edge.
  expect(Math.abs(box.y + box.height - viewport.height)).toBeLessThanOrEqual(2);
});

test('the calendar is a compact month with day details underneath', async ({ page, user }) => {
  void user;
  await page.goto('/calendar');
  await expect(page.getByRole('grid')).toBeVisible();
  const grid = (await page.getByRole('grid').boundingBox())!;
  expect(grid.width).toBeLessThanOrEqual(390);
  await expect(page.getByText('Payments to come')).toBeVisible();
});
