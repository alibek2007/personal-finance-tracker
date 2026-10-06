import { demo, expect, settled } from '../support/fixtures';

demo('the seeded demo user lands on a populated dashboard', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { level: 1, name: /^Good (morning|afternoon|evening), Alex$/ }),
  ).toBeVisible();
  await settled(page);
  await expect(page.getByText('Total balance')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Coming up' })).toBeVisible();
  await expect(page).toHaveTitle('Dashboard · Ledger');
});
