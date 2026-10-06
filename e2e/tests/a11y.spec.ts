import AxeBuilder from '@axe-core/playwright';
import { demo, expect, settled } from '../support/fixtures';
import { ROUTES } from '../support/routes';

/**
 * Real-browser accessibility: axe-core with colour contrast (which jsdom cannot compute), on every
 * signed-in screen, in both themes, at desktop and phone widths.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

for (const scheme of ['light', 'dark'] as const) {
  for (const size of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'phone', width: 390, height: 844 },
  ]) {
    demo.describe(`${scheme} theme, ${size.name}`, () => {
      demo.use({ colorScheme: scheme, viewport: { width: size.width, height: size.height } });

      for (const route of ROUTES) {
        demo(`${route} has no accessibility violations`, async ({ page }) => {
          await page.goto(route);
          await settled(page);
          // Let charts finish drawing and fonts load before measuring contrast.
          await page.evaluate(() => document.fonts.ready);
          await page.waitForTimeout(300);

          const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
          const report = results.violations.map(
            (v) =>
              `${v.id} (${v.impact}): ${v.help}\n` +
              v.nodes
                .slice(0, 4)
                .map(
                  (n) => `   ${n.target.join(' ')}\n   ${n.failureSummary?.split('\n')[1] ?? ''}`,
                )
                .join('\n'),
          );
          expect(report, report.join('\n\n')).toEqual([]);
        });
      }
    });
  }
}

demo('dialogs and menus are accessible too', async ({ page }) => {
  await page.goto('/recurring');
  await settled(page);
  await page.getByRole('button', { name: /Add recurring payment/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Add payment' }).click();
  await expect(page.getByRole('dialog').getByRole('alert').first()).toBeVisible();
  let results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
  await page.keyboard.press('Escape');

  await page.keyboard.press('/');
  await page.getByRole('dialog').getByRole('combobox').fill('rent');
  await expect(page.getByRole('dialog').getByText('Rent').first()).toBeVisible();
  results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
});
