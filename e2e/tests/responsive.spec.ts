import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { demo, expect, settled } from '../support/fixtures';
import { ROUTES } from '../support/routes';

/**
 * Visual QA at the four widths the product is designed for. Beyond the assertions, every page is
 * photographed into e2e/screenshots/<width>/ so a human can review them side by side.
 */
const WIDTHS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
];
const SHOTS = resolve(import.meta.dirname, '../screenshots');

for (const { width, height } of WIDTHS) {
  demo.describe(`${width}px`, () => {
    demo.use({ viewport: { width, height } });

    for (const route of ROUTES) {
      demo(`${route}: no horizontal scrolling, nothing clipped, readable`, async ({ page }) => {
        await page.goto(route);
        await settled(page);
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(400);

        const m = await page.evaluate(() => ({
          inner: window.innerWidth,
          scroll: document.documentElement.scrollWidth,
          client: document.documentElement.clientWidth,
        }));
        // The layout viewport must not have been stretched by overflowing content.
        expect(m.inner).toBe(width);
        expect(m.scroll).toBeLessThanOrEqual(m.client);

        // Body text never shrinks below 12px, and nothing visible sits off the right edge.
        const offenders = await page.evaluate((w) => {
          const bad: string[] = [];
          for (const el of document.querySelectorAll('main *')) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            if (el.closest('.sr-only, [class*="overflow-x-auto"], [role="region"][tabindex]'))
              continue;
            if (r.right > w + 1) bad.push(`${el.tagName}.${String(el.className).slice(0, 40)}`);
          }
          return bad.slice(0, 5);
        }, width);
        expect(offenders, `elements beyond the right edge: ${offenders.join(', ')}`).toEqual([]);

        const dir = resolve(SHOTS, String(width));
        mkdirSync(dir, { recursive: true });
        const name = route === '/' ? 'dashboard' : route.slice(1).replace(/\//g, '-');
        await page.screenshot({ path: resolve(dir, `${name}.png`), fullPage: true });
      });
    }
  });
}

demo.describe('phone ergonomics', () => {
  demo.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  demo('buttons and fields are big enough to tap (WCAG 2.2 target size)', async ({ page }) => {
    const small: string[] = [];
    for (const route of [
      '/',
      '/transactions',
      '/accounts',
      '/budgets',
      '/recurring',
      '/calendar',
    ]) {
      await page.goto(route);
      await settled(page);
      const found = await page.evaluate(() => {
        const out: string[] = [];
        for (const el of document.querySelectorAll(
          'button, [role="button"], input, select, textarea',
        )) {
          // A checkbox inside a <label> is tapped through the label, which is the real target.
          const r = (el.closest('label') ?? el).getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if ((el as HTMLInputElement).type === 'hidden') continue;
          if (el.closest('.sr-only')) continue;
          if (r.width < 24 || r.height < 24) {
            out.push(
              `${(el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 30)} ${Math.round(r.width)}x${Math.round(r.height)}`,
            );
          }
        }
        return out;
      });
      small.push(...found.map((f) => `${route}: ${f}`));
    }
    expect(small, small.join('\n')).toEqual([]);
  });

  demo('text is at least 12px and the page is not zoom-locked', async ({ page }) => {
    await page.goto('/');
    await settled(page);
    const viewport = await page.locator('meta[name=viewport]').getAttribute('content');
    expect(viewport).not.toMatch(/user-scalable=no|maximum-scale=1(\.0)?(,|$)/);
    const tiny = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of document.querySelectorAll('main *')) {
        if (
          !el.childNodes.length ||
          ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim())
        )
          continue;
        const size = parseFloat(getComputedStyle(el).fontSize);
        if (size < 11) out.push(`${el.tagName} ${size}px "${el.textContent?.trim().slice(0, 20)}"`);
      }
      return out.slice(0, 8);
    });
    expect(tiny).toEqual([]);
  });
});
