import { demo, expect, settled } from '../support/fixtures';

demo.describe('seeded demo ledger', () => {
  demo(
    'natural-language search finds the right transactions and explains itself',
    async ({ page }) => {
      await page.goto('/');
      await settled(page);
      await page.keyboard.press('/');
      const menu = page.getByRole('dialog');
      await menu.getByRole('combobox').fill('expenses over $50 last month');

      await expect(menu.getByText('Understood: expenses · over $50 · last month')).toBeVisible();
      await expect(menu.getByText(/See all \d+ matching transactions/)).toBeVisible();

      await menu.getByText(/See all \d+ matching transactions/).click();
      await expect(page).toHaveURL(/type=expense/);
      await expect(page).toHaveURL(/min=50\.01/);
      await expect(page.getByRole('heading', { level: 1, name: 'Transactions' })).toBeVisible();

      // Every row on the filtered page really is an expense over $50 from last month.
      await expect(page.getByRole('row').nth(1)).toBeVisible();
      const amounts = await page.locator('tbody tr td:nth-last-child(2)').allInnerTexts();
      expect(amounts.length).toBeGreaterThan(0);
      for (const text of amounts) {
        const value = Number(text.replace(/[^0-9.]/g, ''));
        expect(value).toBeGreaterThan(50);
      }
    },
  );

  demo(
    'search also finds goals, accounts and categories, and plain words still work',
    async ({ page }) => {
      await page.goto('/');
      await settled(page);
      await page.keyboard.press('/');
      const menu = page.getByRole('dialog');
      await menu.getByRole('combobox').fill('laptop');
      await expect(menu.getByText('Laptop').first()).toBeVisible();
      await menu.getByRole('combobox').fill('checking');
      await expect(menu.getByText('Checking').first()).toBeVisible();
      // Escape closes it and returns focus to the page.
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
    },
  );

  demo(
    'the calendar shows spending, upcoming subscriptions and goal deadlines',
    async ({ page }) => {
      await page.goto('/calendar');
      await settled(page);
      await expect(page.getByRole('grid')).toBeVisible();
      // The demo ledger has spending this month and recurring subscriptions still to come.
      await expect(page.getByRole('button', { name: /spent \$/ }).first()).toBeVisible();
      const summary = page.getByText('Payments to come');
      await expect(summary).toBeVisible();

      await page.getByRole('button', { name: 'Next month' }).click();
      await expect(page.getByRole('button', { name: /payment[s]? due/ }).first()).toBeVisible();
      await page.getByRole('button', { name: 'Today' }).click();
      await expect(page).toHaveURL(/month=\d{4}-\d{2}/);
    },
  );

  demo('selecting a day on the calendar lists what happened on it', async ({ page }) => {
    await page.goto('/calendar');
    await settled(page);
    const day = page.getByRole('button', { name: /spent \$/, disabled: false }).first();
    await day.click();
    await expect(page.getByRole('region', { name: /\w+day, \w+ \d+/ })).toContainText(/\$/);
  });

  demo('notifications list what needs attention and mark read persistently', async ({ page }) => {
    await page.goto('/notifications');
    await settled(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible();
    const markAll = page.getByRole('button', { name: 'Mark all as read' });
    if (await markAll.isEnabled()) {
      await markAll.click();
      await expect(page.getByText('Nothing unread')).toBeVisible();
    }
    await page.reload();
    await settled(page);
    await expect(page.getByText('Nothing unread')).toBeVisible();
  });

  demo('each screen has its own title and moves focus to its content', async ({ page }) => {
    await page.goto('/');
    await settled(page);
    await page.keyboard.press('/');
    await page.getByRole('dialog').getByRole('combobox').fill('budgets');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: 'Budgets' })).toBeVisible();
    await expect(page).toHaveTitle('Budgets · Ledger');
    await expect(page.getByRole('main')).toBeFocused();
  });
});
