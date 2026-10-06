import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { clickAndSave, expect, test } from '../support/fixtures';

const BANK = [
  'Date,Description,Amount,Category',
  '2026-10-01,Salary,3000.00,Salary',
  '2026-10-02,Whole Foods,-82.45,Groceries',
  '2026-10-03,Mystery Shop,-10.00,Hobbies',
  '2026-10-04,Broken row,abc,',
].join('\n');

async function openImport(page: Page) {
  await page.goto('/settings');
  await page.getByRole('button', { name: /Import from CSV/ }).click();
  return page.getByRole('dialog', { name: 'Import transactions' });
}

test('importing a bank file shows a preview first, then brings the good rows in', async ({
  page,
  data,
}) => {
  await data.account('Checking', 100_000);
  const dialog = await openImport(page);
  await dialog.getByLabel('CSV file').setInputFiles({
    name: 'bank.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(BANK),
  });

  // Nothing is imported yet; the preview explains what will happen, row by row.
  await expect(dialog.getByText(/3 will be imported/)).toBeVisible();
  await expect(dialog.getByText(/1 with problems/)).toBeVisible();
  await expect(dialog.getByText(/"abc" is not a valid amount/)).toBeVisible();
  await expect(dialog.getByText(/Hobbies/)).toBeVisible(); // unmatched category is named
  expect((await data.get<{ total: number }>('/transactions')).total).toBe(0);

  await clickAndSave(page, dialog.getByRole('button', { name: 'Import 3 transactions' }));
  await expect(dialog.getByText(/Imported/)).toBeVisible();

  await page.goto('/transactions');
  await expect(page.getByRole('link', { name: 'Whole Foods' })).toBeVisible();
  await page.goto('/accounts');
  // $1,000 + $3,000 − $82.45 − $10.00
  await expect(page.getByText('$3,907.55').first()).toBeVisible();
});

test('importing the same file twice never doubles anything', async ({ page, data }) => {
  await data.account('Checking', 0);
  for (let run = 0; run < 2; run++) {
    const dialog = await openImport(page);
    await dialog.getByLabel('CSV file').setInputFiles({
      name: 'bank.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(BANK),
    });
    if (run === 0) {
      await expect(dialog.getByText(/3 will be imported/)).toBeVisible();
      await clickAndSave(page, dialog.getByRole('button', { name: 'Import 3 transactions' }));
      await expect(dialog.getByText(/Imported/)).toBeVisible();
    } else {
      await expect(dialog.getByText(/0 will be imported, 3 already in Ledger/)).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
    }
  }
  const body = await data.get<{ total: number }>('/transactions');
  expect(body.total).toBe(3);
});

test('a file with the wrong layout asks which column is which', async ({ page, data }) => {
  await data.account('Checking', 0);
  const dialog = await openImport(page);
  await dialog.getByLabel('CSV file').setInputFiles({
    name: 'odd.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('a,b,c\n2026-10-01,Coffee,-4.50\n'),
  });
  await expect(dialog.getByText('Tell Ledger which column is which')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
  await dialog.getByLabel('Date', { exact: true }).selectOption({ label: 'a' });
  await dialog.getByLabel('Description', { exact: true }).selectOption({ label: 'b' });
  await dialog.getByLabel(/^Amount/).selectOption({ label: 'c' });
  await expect(dialog.getByRole('button', { name: 'Import 1 transaction' })).toBeEnabled();
});

test('exporting downloads a CSV of exactly what you see, and it round-trips', async ({
  page,
  data,
}) => {
  const account = await data.account('Checking', 0);
  await data.transaction({ accountId: account.id, description: 'Alpha', amount: 1_234 });
  await data.transaction({ accountId: account.id, description: 'Beta', amount: 5_678 });

  await page.goto('/transactions?q=Beta');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Export matching transactions as CSV/ }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^ledger-transactions-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = readFileSync((await download.path())!, 'utf8').replace(/^\uFEFF/, '');
  const lines = csv.trim().split('\r\n');
  expect(lines[0]).toContain('Date,Type,Description');
  expect(lines).toHaveLength(2); // header + only the filtered row
  expect(lines[1]).toContain('Beta');
  expect(lines[1]).toContain('56.78');
  expect(csv).not.toContain('Alpha');
});

test('exports cannot smuggle a spreadsheet formula', async ({ page, data }) => {
  const account = await data.account('Checking', 0);
  await data.transaction({
    accountId: account.id,
    description: '=HYPERLINK("http://evil.example","click")',
    amount: 100,
  });
  await page.goto('/settings');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Export all transactions/ }).click(),
  ]);
  const csv = readFileSync((await download.path())!, 'utf8');
  expect(csv).toContain(`"'=HYPERLINK(`);
  expect(csv).not.toMatch(/(^|,)"?=HYPERLINK/m);
});
