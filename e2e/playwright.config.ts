import { defineConfig, devices } from '@playwright/test';

const WEB_PORT = 5273;
const API_PORT = 4100;
const DB_PORT = 54331;
const baseURL = `http://localhost:${WEB_PORT}`;

/**
 * Everything runs against a real stack: embedded PostgreSQL (seeded with the demo ledger), the API, and
 * the Vite dev server, on ports of their own so a running dev environment is never touched.
 */
export default defineConfig({
  testDir: './tests',
  outputDir: './.results',
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { outputFolder: './.report', open: 'never' }]],
  globalSetup: './global-setup.ts',
  use: {
    baseURL,
    // Uses the Chrome installed on the machine (no browser download needed). Set E2E_BROWSER=chromium
    // after `npx playwright install chromium` to use Playwright's own build instead.
    ...(process.env.E2E_BROWSER === 'chromium' ? {} : { channel: 'chrome' }),
    locale: 'en-US',
    // Matches the demo user's timezone, so "today" means the same thing to the browser and the server.
    timezoneId: 'America/New_York',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    reducedMotion: 'reduce',
  },
  projects: [
    {
      name: 'desktop',
      testIgnore: /mobile\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        channel: process.env.E2E_BROWSER === 'chromium' ? undefined : 'chrome',
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'mobile',
      testMatch: /mobile\.spec\.ts/,
      use: {
        ...devices['Pixel 7'],
        channel: process.env.E2E_BROWSER === 'chromium' ? undefined : 'chrome',
        viewport: { width: 390, height: 844 },
      },
    },
  ],
  webServer: [
    {
      name: 'api',
      command: 'npx tsx apps/api/src/server.ts',
      cwd: '..',
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'ignore',
      env: {
        NODE_ENV: 'development',
        API_HOST: '127.0.0.1',
        API_PORT: String(API_PORT),
        WEB_ORIGINS: baseURL,
        DATABASE_URL: `postgresql://pfm:pfm_dev_password@127.0.0.1:${DB_PORT}/pfm_e2e?schema=public`,
        SESSION_SECRET: 'e2e-only-session-secret-e2e-only-session-secret',
        COOKIE_SECURE: 'false',
        AUTH_RATE_LIMIT_MAX: '500',
        // Four browsers load many pages a minute; the production default (300/min per IP) is for people.
        RATE_LIMIT_MAX: '100000',
        LOG_LEVEL: 'warn',
      },
    },
    {
      name: 'web',
      command: `npx vite --port ${WEB_PORT} --strictPort --host localhost`,
      cwd: '../apps/web',
      url: baseURL,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'ignore',
      env: { API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}` },
    },
  ],
});
