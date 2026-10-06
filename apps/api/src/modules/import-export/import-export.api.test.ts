import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApiClient, type ApiClient, type Session } from '../../../test/api-client';
import { createTestApp, resetDb } from '../../../test/helpers';

type Ctx = Awaited<ReturnType<typeof createTestApp>>;
const clock = new Date('2026-10-15T12:00:00Z');

interface Preview {
  headers: string[];
  mapping: Record<string, number> | null;
  guessedMapping: Record<string, number>;
  rowCount: number;
  counts: { ok: number; duplicate: number; error: number };
  totals: { income: number; expense: number };
  unmatchedCategories: string[];
  rows: { line: number; status: string; errors: string[]; description: string }[];
}

describe('CSV import and export API', () => {
  let ctx: Ctx;
  let api: ApiClient;
  let alex: Session;
  let checking: string;
  let cat: Record<string, string>;

  beforeAll(async () => {
    ctx = await createTestApp({}, { now: () => clock });
    api = createApiClient(ctx);
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.db);
    alex = await api.signUp('alex@example.com', 'Alex');
    checking = (
      await api.post('/api/accounts', alex, {
        name: 'Checking',
        type: 'bank',
        currency: 'USD',
        initialBalance: 100000,
      })
    ).json().id;
    const cats = (await api.get('/api/categories', alex)).json().categories as {
      id: string;
      name: string;
    }[];
    cat = Object.fromEntries(cats.map((c) => [c.name, c.id]));
  });

  const body = (csv: string, extra: Record<string, unknown> = {}) => ({
    csv,
    accountId: checking,
    ...extra,
  });
  const preview = async (csv: string, extra: Record<string, unknown> = {}, s = alex) => {
    const res = await api.post('/api/import/transactions/preview', s, body(csv, extra));
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as Preview;
  };
  const commit = (csv: string, extra: Record<string, unknown> = {}, s = alex) =>
    api.post('/api/import/transactions', s, body(csv, extra));
  const balance = async () =>
    (await api.get(`/api/accounts/${checking}`, alex)).json().currentBalance as number;
  const count = async () => ctx.db.transaction.count();

  const BANK = [
    'Date,Description,Amount,Category',
    '2026-10-01,Salary,3000.00,Salary',
    '2026-10-02,Whole Foods,-82.45,Groceries',
    '2026-10-03,Mystery Shop,-10.00,Hobbies',
  ].join('\n');

  describe('preview', () => {
    it('guesses the columns and reports what would happen without changing anything', async () => {
      const p = await preview(BANK);
      expect(p.mapping).toEqual({ date: 0, description: 1, amount: 2, category: 3 });
      expect(p.counts).toEqual({ ok: 3, duplicate: 0, error: 0 });
      expect(p.totals).toEqual({ income: 300000, expense: 9245 });
      expect(p.unmatchedCategories).toEqual(['Hobbies']);
      expect(await count()).toBe(0);
      expect(await balance()).toBe(100000);
    });

    it('asks for a mapping when it cannot guess one', async () => {
      const p = await preview('a,b,c\n2026-10-01,x,5');
      expect(p.mapping).toBeNull();
      expect(p.headers).toEqual(['a', 'b', 'c']);
      expect(p.rows).toEqual([]);
    });

    it('uses the mapping you give it', async () => {
      const p = await preview('a,b,c\n2026-10-01,Coffee,-5', {
        mapping: { date: 0, description: 1, amount: 2 },
      });
      expect(p.counts.ok).toBe(1);
    });

    it('explains each bad row by line number, errors first', async () => {
      const csv = [
        'Date,Description,Amount',
        '2026-10-01,Ok,-5.00',
        'not a date,Bad date,-5.00',
        '2026-10-02,Bad amount,abc',
        '2026-10-02,Zero,0',
        '2026-10-02,,-5.00',
        '2026-02-31,Impossible,-5.00',
      ].join('\n');
      const p = await preview(csv);
      expect(p.counts).toEqual({ ok: 1, duplicate: 0, error: 5 });
      const byLine = Object.fromEntries(p.rows.map((r) => [r.line, r.errors.join(' ')]));
      expect(byLine[3]).toMatch(/not a valid date/);
      expect(byLine[4]).toMatch(/not a valid amount/);
      expect(byLine[5]).toMatch(/can't be zero/);
      expect(byLine[6]).toMatch(/no description/);
      expect(byLine[7]).toMatch(/not a valid date/);
    });

    it('understands debit/credit columns, a type column and decimal commas', async () => {
      const dc = await preview(
        'Date,Payee,Debit,Credit\n2026-10-01,Shop,12.50,\n2026-10-02,Pay,,100.00\n2026-10-03,Odd,1,1',
      );
      expect(dc.counts).toEqual({ ok: 2, duplicate: 0, error: 1 });
      expect(dc.totals).toEqual({ income: 10000, expense: 1250 });

      const typed = await preview(
        'Date,Description,Amount,Type\n2026-10-01,Shop,12.50,Expense\n2026-10-02,Move,5,Transfer',
      );
      expect(typed.counts).toEqual({ ok: 1, duplicate: 0, error: 1 });
      expect(typed.rows.find((r) => r.status === 'error')!.errors[0]).toMatch(/Transfers/);

      const eu = await preview('Datum;Beschreibung;Betrag\n05.10.2026;Cafe;-1.234,56', {
        dateOrder: 'DMY',
        decimal: ',',
        mapping: { date: 0, description: 1, amount: 2 },
      });
      expect(eu.totals.expense).toBe(123456);
    });

    it('rejects broken files and unknown accounts clearly', async () => {
      const broken = await api.post('/api/import/transactions/preview', alex, body('a,b\n"oops'));
      expect(broken.statusCode).toBe(400);
      expect(broken.json().error.code).toBe('invalid_csv');

      const empty = await api.post('/api/import/transactions/preview', alex, body('   \n'));
      expect(empty.json().error.code).toBe('invalid_csv');

      const bea = await api.signUp('bea@example.com', 'Bea');
      const foreign = await api.post('/api/import/transactions/preview', bea, body(BANK));
      expect(foreign.statusCode).toBe(400);
      expect(foreign.json().error.details.accountId).toBeDefined();

      await api.patch(`/api/accounts/${checking}`, alex, { isArchived: true });
      const archived = await api.post('/api/import/transactions/preview', alex, body(BANK));
      expect(archived.json().error.details.accountId).toBeDefined();
    });

    it('refuses an out-of-range column in a mapping', async () => {
      const res = await api.post(
        '/api/import/transactions/preview',
        alex,
        body(BANK, { mapping: { date: 0, description: 1, amount: 9 } }),
      );
      expect(res.statusCode).toBe(400);
    });

    it('limits the number of rows', async () => {
      const lines = ['Date,Description,Amount'];
      for (let i = 0; i < 5001; i++) lines.push('2026-10-01,x,-1');
      const res = await api.post('/api/import/transactions/preview', alex, body(lines.join('\n')));
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('too_many_rows');
    });
  });

  describe('importing', () => {
    it('creates transactions through the ledger: balances, categories, signs', async () => {
      const res = await commit(BANK);
      expect(res.json()).toEqual({ imported: 3, skippedDuplicates: 0, skippedErrors: 0 });
      expect(await balance()).toBe(100000 + 300000 - 8245 - 1000);
      const list = (await api.get('/api/transactions?pageSize=10&sort=date&dir=asc', alex)).json()
        .items as {
        description: string;
        type: string;
        amount: number;
        categoryId: string | null;
      }[];
      expect(list.map((t) => [t.description, t.type, t.amount])).toEqual([
        ['Salary', 'income', 300000],
        ['Whole Foods', 'expense', 8245],
        ['Mystery Shop', 'expense', 1000],
      ]);
      expect(list[0]!.categoryId).toBe(cat.Salary);
      expect(list[1]!.categoryId).toBe(cat.Groceries);
      expect(list[2]!.categoryId).toBeNull(); // unmatched category: uncategorised, not invented
      expect((await api.post('/api/accounts/reconcile', alex)).json().drift).toEqual([]);
    });

    it('is safe to run twice: the second run changes nothing', async () => {
      await commit(BANK);
      const again = await commit(BANK);
      expect(again.json()).toEqual({ imported: 0, skippedDuplicates: 3, skippedErrors: 0 });
      expect(await count()).toBe(3);
      const p = await preview(BANK);
      expect(p.counts).toEqual({ ok: 0, duplicate: 3, error: 0 });
    });

    it('keeps genuinely repeated purchases (two identical coffees), but not a re-import of them', async () => {
      const csv = 'Date,Description,Amount\n2026-10-01,Coffee,-4.50\n2026-10-01,Coffee,-4.50';
      expect((await commit(csv)).json().imported).toBe(2);
      expect((await commit(csv)).json().imported).toBe(0);
      // A later file with three of them brings in only the new one.
      const three = `${csv}\n2026-10-01,Coffee,-4.50`;
      expect((await commit(three)).json()).toMatchObject({ imported: 1, skippedDuplicates: 2 });
      expect(await count()).toBe(3);
    });

    it('can be told to import duplicates anyway', async () => {
      await commit(BANK);
      const res = await commit(BANK, { skipDuplicates: false });
      expect(res.json().imported).toBe(3);
      expect(await count()).toBe(6);
    });

    it('imports the good rows and reports the rest', async () => {
      const csv =
        'Date,Description,Amount\n2026-10-01,Fine,-5\nbad,Broken,-5\n2026-10-02,Also fine,-6';
      expect((await commit(csv)).json()).toEqual({
        imported: 2,
        skippedDuplicates: 0,
        skippedErrors: 1,
      });
    });

    it('does not match a duplicate across different accounts', async () => {
      const other = (
        await api.post('/api/accounts', alex, { name: 'Savings', type: 'savings', currency: 'USD' })
      ).json().id;
      await commit(BANK);
      const res = await api.post('/api/import/transactions', alex, {
        csv: BANK,
        accountId: other,
      });
      expect(res.json().imported).toBe(3);
    });

    it('requires a usable mapping to import', async () => {
      const res = await commit('a,b,c\n2026-10-01,x,5');
      expect(res.statusCode).toBe(400);
      expect(await count()).toBe(0);
    });

    it('records an audit entry without the file contents', async () => {
      await commit(BANK);
      const log = await ctx.db.auditLog.findFirst({ where: { action: 'import.transactions' } });
      expect(log?.metadata).toEqual({ imported: 3, skippedDuplicates: 0, skippedErrors: 0 });
    });

    it('requires sign-in', async () => {
      expect((await commit(BANK, {}, null as unknown as Session)).statusCode).toBe(401);
    });
  });

  describe('exporting', () => {
    beforeEach(async () => {
      await commit(BANK);
      await api.post('/api/transactions', alex, {
        type: 'expense',
        accountId: checking,
        amount: 500,
        description: '=HYPERLINK("http://evil.example")',
        merchant: 'Shop, Inc.',
        notes: 'line one\nline two',
        date: '2026-10-05',
      });
    });
    const exportCsv = (query = '') => api.get(`/api/export/transactions${query}`, alex);

    it('downloads a CSV with exact amounts and readable names', async () => {
      const res = await exportCsv();
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toBe(
        'attachment; filename="ledger-transactions-2026-10-15.csv"',
      );
      expect(res.headers['cache-control']).toBe('no-store');
      const text = res.body.replace(/^\uFEFF/, '');
      const lines = text.split('\r\n');
      expect(lines[0]).toBe(
        'Date,Type,Description,Merchant,Amount,Currency,Category,Account,Transfer to,Transfer amount,Refund,Recurring,Notes',
      );
      expect(lines[1]).toBe('2026-10-01,income,Salary,,3000.00,USD,Salary,Checking,,,false,false,');
      expect(lines[2]).toBe(
        '2026-10-02,expense,Whole Foods,,82.45,USD,Groceries,Checking,,,false,false,',
      );
    });

    it('defuses formulas and quotes awkward cells', async () => {
      const text = (await exportCsv()).body;
      expect(text).toContain(`"'=HYPERLINK(""http://evil.example"")"`);
      expect(text).toContain('"Shop, Inc."');
      expect(text).toContain('"line one\nline two"');
    });

    it('honours filters and ignores paging', async () => {
      const res = await exportCsv('?type=income&page=3&pageSize=1');
      const lines = res.body
        .replace(/^\uFEFF/, '')
        .trim()
        .split('\r\n');
      expect(lines).toHaveLength(2);
      expect(lines[1]).toContain('Salary');
    });

    it('round-trips: exporting then importing into an empty account restores the same books', async () => {
      const csv = (await exportCsv()).body;
      const fresh = (
        await api.post('/api/accounts', alex, { name: 'Copy', type: 'bank', currency: 'USD' })
      ).json().id;
      const p = await api.post('/api/import/transactions/preview', alex, {
        csv,
        accountId: fresh,
      });
      expect(p.json().counts).toEqual({ ok: 4, duplicate: 0, error: 0 });
      expect(p.json().mapping).not.toBeNull();
      const res = await api.post('/api/import/transactions', alex, { csv, accountId: fresh });
      expect(res.json().imported).toBe(4);
      const copy = (await api.get(`/api/accounts/${fresh}`, alex)).json().currentBalance;
      expect(copy).toBe(300000 - 8245 - 1000 - 500);
    });

    it('records the export and only includes your own data', async () => {
      await exportCsv();
      expect(await ctx.db.auditLog.count({ where: { action: 'export.transactions' } })).toBe(1);
      const bea = await api.signUp('bea@example.com', 'Bea');
      const res = await api.get('/api/export/transactions', bea);
      expect(
        res.body
          .replace(/^\uFEFF/, '')
          .trim()
          .split('\r\n'),
      ).toHaveLength(1); // header only
    });

    it('requires sign-in', async () => {
      expect((await api.get('/api/export/transactions', null)).statusCode).toBe(401);
    });
  });
});
