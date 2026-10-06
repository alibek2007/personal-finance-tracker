import { demo, expect, settled } from '../support/fixtures';

/** What a person who never touches the mouse experiences. */

demo('the first Tab stop is a skip link that jumps past the navigation', async ({ page }) => {
  await page.goto('/transactions');
  await settled(page);
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
});

demo('every control reached by Tab shows a visible focus indicator', async ({ page }) => {
  await page.goto('/');
  await settled(page);
  const missing: string[] = [];
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
      const shadow = cs.boxShadow !== 'none';
      // Some controls draw their focus ring on a wrapper (the :has() / focus-within pattern).
      const parent = el.closest('[class*="focus-within"]');
      const ring = parent ? getComputedStyle(parent).boxShadow !== 'none' : false;
      const label = (el.getAttribute('aria-label') || el.textContent || el.tagName)
        .trim()
        .slice(0, 40);
      return { ok: outline || shadow || ring, label };
    });
    if (info && !info.ok) missing.push(info.label);
  }
  expect(missing, `no visible focus on: ${missing.join(', ')}`).toEqual([]);
});

demo(
  'the command menu traps focus, closes with Escape, and finds things by typing',
  async ({ page }) => {
    await page.goto('/');
    await settled(page);
    await page.keyboard.press('/');
    const menu = page.getByRole('dialog');
    await expect(menu.getByRole('combobox')).toBeFocused();

    for (let i = 0; i < 12; i++) await page.keyboard.press('Tab');
    expect(await menu.evaluate((el) => el.contains(document.activeElement))).toBe(true);

    await menu.getByRole('combobox').fill('analytics');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: 'Analytics' })).toBeVisible();

    await page.keyboard.press('/');
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  },
);

demo('a dialog traps focus and returns it to the button that opened it', async ({ page }) => {
  await page.goto('/accounts');
  await settled(page);
  const opener = page.getByRole('button', { name: 'Add account' });
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Add account' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Name')).toBeFocused();

  for (let i = 0; i < 25; i++) await page.keyboard.press('Tab');
  expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  for (let i = 0; i < 25; i++) await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

demo(
  'the transaction form is usable from the keyboard alone, and errors are announced',
  async ({ page }) => {
    await page.goto('/');
    await settled(page);
    await page.keyboard.press('n');
    await expect(page.getByRole('heading', { level: 1, name: 'Add transaction' })).toBeVisible();
    // The amount is focused on arrival, so typing starts immediately.
    await expect(page.getByLabel('Amount', { exact: true })).toBeFocused();

    await page.getByLabel('Description').focus();
    await page.keyboard.press('Enter'); // submit an incomplete form
    const alerts = page.getByRole('alert');
    await expect(alerts.first()).toBeVisible();
    await expect(page.getByLabel('Amount', { exact: true })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    // The error text is wired to the field for screen readers.
    const described = await page
      .getByLabel('Amount', { exact: true })
      .getAttribute('aria-describedby');
    expect(described).toBeTruthy();
  },
);

demo('segmented controls and menus work with arrow keys', async ({ page }) => {
  await page.goto('/transactions/new');
  await settled(page);
  const expense = page.getByRole('radio', { name: 'Expense' });
  await expense.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'Income' })).toBeChecked();

  await page.goto('/');
  await settled(page);
  await page.getByRole('button', { name: /Account menu/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Profile' })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menuitem', { name: 'Profile' })).toBeHidden();
});

demo('the calendar grid can be driven from the keyboard', async ({ page }) => {
  await page.goto('/calendar');
  await settled(page);
  const day = page.getByRole('button', { name: /spent \$/, disabled: false }).first();
  await day.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: /\w+day, \w+ \d+/ })).toBeVisible();
});
