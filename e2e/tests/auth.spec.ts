import { test as base, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PASSWORD } from '../support/fixtures';

// These tests start signed out.
const test = base;
const email = () => `e2e-${randomUUID().slice(0, 8)}@example.com`;

async function signOut(page: Page) {
  await page.getByRole('button', { name: /Account menu/ }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
}

test('a visitor can create an account and lands on an honest, empty dashboard', async ({
  page,
}) => {
  const mail = email();
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Sam Rivera');
  await page.getByLabel('Email').fill(mail);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page.getByRole('heading', { level: 1, name: /Sam/ })).toBeVisible();
  // No invented numbers for a brand-new user.
  await expect(page.getByText(/fills in as you add/i)).toBeVisible();
  await expect(page).toHaveTitle('Dashboard · Ledger');
});

test('signing out ends the session, and signing back in returns to where you were headed', async ({
  page,
}) => {
  const mail = email();
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Sam');
  await page.getByLabel('Email').fill(mail);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /Sam/ })).toBeVisible();

  await signOut(page);

  // A protected page sends a signed-out visitor to sign in, and remembers the destination.
  await page.goto('/budgets');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await page.getByLabel('Email').fill(mail);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Budgets' })).toBeVisible();
});

test('a wrong password is refused without saying which half was wrong', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('alex@example.com');
  await page.getByLabel('Password').fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  const alert = page.getByRole('alert');
  await expect(alert).toBeVisible();
  await expect(alert).not.toContainText(/no account|not found|does not exist/i);
  await expect(page).toHaveURL(/\/login/);
});

test('weak passwords and bad emails are explained before anything is sent', async ({ page }) => {
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Sam');
  await page.getByLabel('Email').fill('not-an-email');
  await page.getByLabel('Password').fill('short');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText(/valid email/i)).toBeVisible();
  await expect(page.getByText(/at least 10 characters/i).last()).toBeVisible();
  await expect(page).toHaveURL(/\/register/);
});

test('a second sign-up with the same email is refused', async ({ page }) => {
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Impostor');
  await page.getByLabel('Email').fill('alex@example.com');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('alert').first()).toBeVisible();
  await expect(page).toHaveURL(/\/register/);
});

test('the session cookie is HttpOnly, so page scripts cannot read it', async ({
  page,
  context,
}) => {
  const mail = email();
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Sam');
  await page.getByLabel('Email').fill(mail);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /Sam/ })).toBeVisible();

  const cookie = (await context.cookies()).find((c) => c.name === 'pfm_session');
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe('Lax');
  expect(await page.evaluate(() => document.cookie)).not.toContain('pfm_session');
});
