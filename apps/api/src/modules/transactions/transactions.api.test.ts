import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApiClient, type ApiClient, type Session } from '../../../test/api-client';
import { createTestApp, resetDb } from '../../../test/helpers';

type Ctx = Awaited<ReturnType<typeof createTestApp>>;

describe('ledger API', () => {
  let ctx: Ctx;
  let api: ApiClient;
  let alex: Session;
  let bea: Session;

  beforeAll(async () => {
    ctx = await createTestApp();
    api = createApiClient(ctx);
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.db);
    alex = await api.signUp('alex@example.com', 'Alex');
    bea = await api.signUp('bea@example.com', 'Bea');
  });

  // ---------------------------------------------------------------- helpers
  async function account(
    s: Session,
    name: string,
    opts: { type?: string; currency?: string; initialBalance?: number } = {},
  ) {
    const res = await api.post('/api/accounts', s, {
      name,
      type: opts.type ?? 'bank',
      currency: opts.currency ?? 'USD',
      initialBalance: opts.initialBalance ?? 0,
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json() as { id: string; currentBalance: number };
  }
  async function category(s: Session, name: string): Promise<string> {
    const res = await api.get('/api/categories', s);
    const found = (res.json().categories as { id: string; name: string }[]).find(
      (c) => c.name === name,
    );
    if (!found) throw new Error(`no category ${name}`);
    return found.id;
  }
  async function balance(s: Session, id: string): Promise<number> {
    return (await api.get(`/api/accounts/${id}`, s)).json().currentBalance;
  }
  async function expectReconciled(s: Session) {
    const res = await api.post('/api/accounts/reconcile', s);
    expect(res.json().drift).toEqual([]);
  }
  const tx = (over: Record<string, unknown>) => ({
    type: 'expense',
    amount: 1000,
    description: 'Test',
    date: '2026-10-01',
    ...over,
  });
  async function addTx(s: Session, body: Record<string, unknown>) {
    const res = await api.post('/api/transactions', s, tx(body));
    expect(res.statusCode, res.body).toBe(201);
    return res.json() as {
      id: string;
      amount: number;
      transferAmount: number | null;
      currency: string;
    };
  }

  // ---------------------------------------------------------------- accounts
  describe('accounts', () => {
    it('lists balances with net worth that subtracts credit card debt', async () => {
      await account(alex, 'Cash', { type: 'cash', initialBalance: 24000 });
      await account(alex, 'Checking', { initialBalance: 432000 });
      await account(alex, 'Savings', { type: 'savings', initialBalance: 850000 });
      await account(alex, 'Visa', { type: 'credit_card', initialBalance: -82000 });
      const res = await api.get('/api/accounts', alex);
      expect(res.json().totals).toEqual([
        { currency: 'USD', assets: 1_306_000, debts: 82000, netWorth: 1_224_000 },
      ]);
    });

    it('rejects duplicate names case-insensitively', async () => {
      await account(alex, 'Checking');
      const res = await api.post('/api/accounts', alex, {
        name: 'checking',
        type: 'bank',
        currency: 'USD',
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('account_name_taken');
      // another user may reuse the name
      expect(
        (await api.post('/api/accounts', bea, { name: 'Checking', type: 'bank', currency: 'USD' }))
          .statusCode,
      ).toBe(201);
    });

    it('correcting the opening balance shifts the current balance by the difference', async () => {
      const acc = await account(alex, 'Checking', { initialBalance: 10000 });
      await addTx(alex, { accountId: acc.id, type: 'expense', amount: 2500 });
      const res = await api.patch(`/api/accounts/${acc.id}`, alex, { initialBalance: 12000 });
      expect(res.json().currentBalance).toBe(12000 - 2500);
      await expectReconciled(alex);
    });

    it('cannot delete an account with history; archiving keeps it in net worth while it holds money', async () => {
      const acc = await account(alex, 'Old', { initialBalance: 5000 });
      await addTx(alex, { accountId: acc.id, type: 'expense', amount: 100 });
      const del = await api.delete(`/api/accounts/${acc.id}`, alex);
      expect(del.statusCode).toBe(409);
      expect(del.json().error.code).toBe('has_transactions');

      await api.patch(`/api/accounts/${acc.id}`, alex, { isArchived: true });
      const visible = await api.get('/api/accounts', alex);
      expect(visible.json().accounts).toHaveLength(0);
      expect(visible.json().totals[0].netWorth).toBe(4900);
      const all = await api.get('/api/accounts?includeArchived=true', alex);
      expect(all.json().accounts).toHaveLength(1);
    });

    it('an unused account can be deleted', async () => {
      const acc = await account(alex, 'Temp');
      expect((await api.delete(`/api/accounts/${acc.id}`, alex)).statusCode).toBe(200);
      expect((await api.get(`/api/accounts/${acc.id}`, alex)).statusCode).toBe(404);
    });

    it('reports balance history by day', async () => {
      const acc = await account(alex, 'Checking', { initialBalance: 1000 });
      await addTx(alex, { accountId: acc.id, type: 'income', amount: 5000, date: '2026-10-01' });
      await addTx(alex, { accountId: acc.id, amount: 200, date: '2026-10-02' });
      await addTx(alex, { accountId: acc.id, amount: 300, date: '2026-10-02' });
      const res = await api.get(`/api/accounts/${acc.id}/balance-history`, alex);
      expect(res.json().points).toEqual([
        { date: '2026-10-01', balance: 6000 },
        { date: '2026-10-02', balance: 5500 },
      ]);
    });
  });

  // ---------------------------------------------------------------- categories
  describe('categories', () => {
    it('gives every new user a starter tree with subcategories', async () => {
      const res = await api.get('/api/categories', alex);
      const cats = res.json().categories as {
        id: string;
        name: string;
        parentId: string | null;
        type: string;
      }[];
      const food = cats.find((c) => c.name === 'Food')!;
      expect(
        cats
          .filter((c) => c.parentId === food.id)
          .map((c) => c.name)
          .sort(),
      ).toEqual(['Coffee', 'Groceries', 'Restaurants']);
      expect(cats.some((c) => c.name === 'Salary' && c.type === 'income')).toBe(true);
    });

    it('enforces nesting depth, matching kinds and unique names', async () => {
      const food = await category(alex, 'Food');
      const coffee = await category(alex, 'Coffee');
      const salary = await category(alex, 'Salary');
      expect(
        (
          await api.post('/api/categories', alex, {
            name: 'Pastry',
            type: 'expense',
            parentId: food,
          })
        ).statusCode,
      ).toBe(201);
      expect(
        (
          await api.post('/api/categories', alex, {
            name: 'Too deep',
            type: 'expense',
            parentId: coffee,
          })
        ).json().error.code,
      ).toBe('too_deep');
      expect(
        (
          await api.post('/api/categories', alex, {
            name: 'Wrong',
            type: 'expense',
            parentId: salary,
          })
        ).json().error.code,
      ).toBe('type_mismatch');
      expect(
        (
          await api.post('/api/categories', alex, {
            name: 'pastry',
            type: 'expense',
            parentId: food,
          })
        ).statusCode,
      ).toBe(409);
    });

    it('deleting a used category requires a destination, then moves the history', async () => {
      const acc = await account(alex, 'Checking');
      const coffee = await category(alex, 'Coffee');
      const restaurants = await category(alex, 'Restaurants');
      const t = await addTx(alex, { accountId: acc.id, categoryId: coffee });
      const blocked = await api.delete(`/api/categories/${coffee}`, alex);
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json().error.code).toBe('has_transactions');
      const moved = await api.delete(`/api/categories/${coffee}?reassignTo=${restaurants}`, alex);
      expect(moved.statusCode).toBe(200);
      expect((await api.get(`/api/transactions/${t.id}`, alex)).json().categoryId).toBe(
        restaurants,
      );
    });

    it('cannot delete a parent that still has subcategories', async () => {
      const food = await category(alex, 'Food');
      expect((await api.delete(`/api/categories/${food}`, alex)).json().error.code).toBe(
        'has_children',
      );
    });
  });

  // ---------------------------------------------------------------- transactions: balances
  describe('balances', () => {
    it('income and expense move the balance and reconcile', async () => {
      const acc = await account(alex, 'Checking', { initialBalance: 100000 });
      await addTx(alex, {
        accountId: acc.id,
        type: 'income',
        amount: 480000,
        categoryId: await category(alex, 'Salary'),
      });
      await addTx(alex, {
        accountId: acc.id,
        type: 'expense',
        amount: 185000,
        categoryId: await category(alex, 'Rent'),
      });
      expect(await balance(alex, acc.id)).toBe(100000 + 480000 - 185000);
      await expectReconciled(alex);
    });

    it('a transfer moves money between accounts and leaves net worth unchanged', async () => {
      const chk = await account(alex, 'Checking', { initialBalance: 200000 });
      const sav = await account(alex, 'Savings', { type: 'savings' });
      const before = (await api.get('/api/accounts', alex)).json().totals[0].netWorth;
      const t = await addTx(alex, {
        type: 'transfer',
        accountId: chk.id,
        transferAccountId: sav.id,
        amount: 50000,
      });
      expect(t.transferAmount).toBe(50000);
      expect(await balance(alex, chk.id)).toBe(150000);
      expect(await balance(alex, sav.id)).toBe(50000);
      expect((await api.get('/api/accounts', alex)).json().totals[0].netWorth).toBe(before);
      await expectReconciled(alex);
    });

    it('transfers are not counted as income or expense when filtering', async () => {
      const chk = await account(alex, 'Checking', { initialBalance: 100000 });
      const sav = await account(alex, 'Savings');
      await addTx(alex, {
        type: 'transfer',
        accountId: chk.id,
        transferAccountId: sav.id,
        amount: 1000,
      });
      expect((await api.get('/api/transactions?type=expense', alex)).json().total).toBe(0);
      expect((await api.get('/api/transactions?type=income', alex)).json().total).toBe(0);
      expect((await api.get('/api/transactions?type=transfer', alex)).json().total).toBe(1);
      // but the transfer is visible from both accounts
      expect((await api.get(`/api/transactions?accountId=${sav.id}`, alex)).json().total).toBe(1);
    });

    it('paying a credit card from checking reduces debt, not net worth', async () => {
      const chk = await account(alex, 'Checking', { initialBalance: 100000 });
      const card = await account(alex, 'Visa', { type: 'credit_card' });
      await addTx(alex, {
        accountId: card.id,
        amount: 82000,
        categoryId: await category(alex, 'Shopping'),
      });
      expect(await balance(alex, card.id)).toBe(-82000);
      const worth = (await api.get('/api/accounts', alex)).json().totals[0];
      expect(worth).toMatchObject({ debts: 82000, netWorth: 100000 - 82000 });
      await addTx(alex, {
        type: 'transfer',
        accountId: chk.id,
        transferAccountId: card.id,
        amount: 82000,
      });
      const paid = (await api.get('/api/accounts', alex)).json().totals[0];
      expect(paid).toMatchObject({ debts: 0, netWorth: 18000 });
      await expectReconciled(alex);
    });

    it('cross-currency transfers credit the stated destination amount', async () => {
      const usd = await account(alex, 'Dollars', { initialBalance: 100000 });
      const kzt = await account(alex, 'Tenge', { currency: 'KZT' });
      const missing = await api.post(
        '/api/transactions',
        alex,
        tx({ type: 'transfer', accountId: usd.id, transferAccountId: kzt.id, amount: 10000 }),
      );
      expect(missing.statusCode).toBe(400);
      expect(missing.json().error.details.transferAmount).toBeTruthy();
      await addTx(alex, {
        type: 'transfer',
        accountId: usd.id,
        transferAccountId: kzt.id,
        amount: 10000,
        transferAmount: 4_700_000,
      });
      expect(await balance(alex, usd.id)).toBe(90000);
      expect(await balance(alex, kzt.id)).toBe(4_700_000);
      // currencies are never added together
      expect(
        (await api.get('/api/accounts', alex))
          .json()
          .totals.map((t: { currency: string }) => t.currency),
      ).toEqual(['KZT', 'USD']);
      await expectReconciled(alex);
    });

    it('editing amount, account and type keeps balances exact', async () => {
      const a = await account(alex, 'A', { initialBalance: 100000 });
      const b = await account(alex, 'B', { initialBalance: 50000 });
      const t = await addTx(alex, { accountId: a.id, amount: 1000 });
      await api.patch(`/api/transactions/${t.id}`, alex, { amount: 2500 });
      expect(await balance(alex, a.id)).toBe(97500);
      await api.patch(`/api/transactions/${t.id}`, alex, { accountId: b.id });
      expect(await balance(alex, a.id)).toBe(100000);
      expect(await balance(alex, b.id)).toBe(47500);
      await api.patch(`/api/transactions/${t.id}`, alex, { type: 'income' });
      expect(await balance(alex, b.id)).toBe(52500);
      await api.patch(`/api/transactions/${t.id}`, alex, {
        type: 'transfer',
        transferAccountId: a.id,
      });
      expect(await balance(alex, b.id)).toBe(47500);
      expect(await balance(alex, a.id)).toBe(102500);
      await expectReconciled(alex);
    });

    it('deleting restores balances, including both sides of a transfer', async () => {
      const a = await account(alex, 'A', { initialBalance: 10000 });
      const b = await account(alex, 'B');
      const t = await addTx(alex, {
        type: 'transfer',
        accountId: a.id,
        transferAccountId: b.id,
        amount: 4000,
      });
      const e = await addTx(alex, { accountId: a.id, amount: 1000 });
      await api.delete(`/api/transactions/${t.id}`, alex);
      await api.delete(`/api/transactions/${e.id}`, alex);
      expect(await balance(alex, a.id)).toBe(10000);
      expect(await balance(alex, b.id)).toBe(0);
      await expectReconciled(alex);
    });

    it('a refund restores the balance and nets against the expense category', async () => {
      const acc = await account(alex, 'Checking', { initialBalance: 10000 });
      const shopping = await category(alex, 'Shopping');
      await addTx(alex, { accountId: acc.id, amount: 4999, categoryId: shopping });
      await addTx(alex, {
        accountId: acc.id,
        type: 'income',
        isRefund: true,
        amount: 4999,
        categoryId: shopping,
        description: 'Return',
      });
      expect(await balance(alex, acc.id)).toBe(10000);
      await expectReconciled(alex);
    });

    it('stays exact under concurrent writes', async () => {
      const acc = await account(alex, 'Checking', { initialBalance: 1_000_000 });
      const amounts = Array.from({ length: 25 }, (_, i) => 100 + i * 7);
      const results = await Promise.all(
        amounts.map((amount) =>
          api.post('/api/transactions', alex, tx({ accountId: acc.id, amount })),
        ),
      );
      expect(results.every((r) => r.statusCode === 201)).toBe(true);
      expect(await balance(alex, acc.id)).toBe(1_000_000 - amounts.reduce((a, b) => a + b, 0));
      await expectReconciled(alex);
    });
  });

  // ---------------------------------------------------------------- transactions: rules
  describe('validation', () => {
    it('rejects zero, negative and fractional amounts', async () => {
      const acc = await account(alex, 'Checking');
      for (const amount of [0, -5, 12.5]) {
        const res = await api.post('/api/transactions', alex, tx({ accountId: acc.id, amount }));
        expect(res.statusCode, String(amount)).toBe(400);
      }
      expect(await balance(alex, acc.id)).toBe(0);
    });

    it('rejects impossible dates and over-long text with field messages', async () => {
      const acc = await account(alex, 'Checking');
      const res = await api.post(
        '/api/transactions',
        alex,
        tx({ accountId: acc.id, date: '2026-02-30', description: '' }),
      );
      expect(res.statusCode).toBe(400);
      expect(Object.keys(res.json().error.details)).toEqual(
        expect.arrayContaining(['date', 'description']),
      );
    });

    it('enforces category kind, transfer rules and archived accounts', async () => {
      const acc = await account(alex, 'Checking');
      const other = await account(alex, 'Other');
      const salary = await category(alex, 'Salary');
      const food = await category(alex, 'Food');

      const wrongKind = await api.post(
        '/api/transactions',
        alex,
        tx({ accountId: acc.id, categoryId: salary }),
      );
      expect(wrongKind.json().error.details.categoryId).toBeTruthy();

      const sameAccount = await api.post(
        '/api/transactions',
        alex,
        tx({ type: 'transfer', accountId: acc.id, transferAccountId: acc.id }),
      );
      expect(sameAccount.json().error.details.transferAccountId).toBeTruthy();

      const transferWithCategory = await api.post(
        '/api/transactions',
        alex,
        tx({ type: 'transfer', accountId: acc.id, transferAccountId: other.id, categoryId: food }),
      );
      expect(transferWithCategory.json().error.details.categoryId).toBeTruthy();

      await api.patch(`/api/accounts/${other.id}`, alex, { isArchived: true });
      const archived = await api.post('/api/transactions', alex, tx({ accountId: other.id }));
      expect(archived.json().error.details.accountId[0]).toMatch(/archived/);
    });
  });

  // ---------------------------------------------------------------- listing
  describe('listing and search', () => {
    async function populate() {
      const chk = await account(alex, 'Checking', { initialBalance: 1_000_000 });
      const cash = await account(alex, 'Cash', { type: 'cash' });
      const coffee = await category(alex, 'Coffee');
      const food = await category(alex, 'Food');
      const rent = await category(alex, 'Rent');
      await addTx(alex, {
        accountId: chk.id,
        amount: 450,
        categoryId: coffee,
        description: 'Latte',
        merchant: 'Blue Bottle',
        date: '2026-09-28',
      });
      await addTx(alex, {
        accountId: chk.id,
        amount: 8400,
        categoryId: food,
        description: 'Groceries',
        merchant: 'Whole Foods',
        date: '2026-09-30',
      });
      await addTx(alex, {
        accountId: chk.id,
        amount: 185000,
        categoryId: rent,
        description: 'October rent',
        date: '2026-10-01',
      });
      await addTx(alex, {
        accountId: cash.id,
        amount: 1200,
        description: 'Taxi home',
        date: '2026-10-02',
      });
      return { chk, cash, coffee, food, rent };
    }

    it('searches description, merchant and category name', async () => {
      await populate();
      const names = async (q: string) =>
        (
          (await api.get(`/api/transactions?q=${encodeURIComponent(q)}`, alex)).json().items as {
            description: string;
          }[]
        ).map((i) => i.description);
      expect(await names('latte')).toEqual(['Latte']);
      expect(await names('whole foods')).toEqual(['Groceries']);
      expect(await names('coffee')).toEqual(['Latte']); // category name
      expect(await names('nothing-matches')).toEqual([]);
    });

    it('a parent category filter includes its subcategories', async () => {
      const { food } = await populate();
      const res = await api.get(`/api/transactions?categoryId=${food}`, alex);
      expect(
        (res.json().items as { description: string }[]).map((i) => i.description).sort(),
      ).toEqual(['Groceries', 'Latte']);
    });

    it('filters by date range (inclusive), amount range and account', async () => {
      const { cash } = await populate();
      expect(
        (await api.get('/api/transactions?dateFrom=2026-09-30&dateTo=2026-10-01', alex)).json()
          .total,
      ).toBe(2);
      expect(
        (await api.get('/api/transactions?amountMin=1000&amountMax=10000', alex)).json().total,
      ).toBe(2);
      expect((await api.get(`/api/transactions?accountId=${cash.id}`, alex)).json().total).toBe(1);
      expect(
        (await api.get('/api/transactions?dateFrom=2026-10-05&dateTo=2026-10-01', alex)).statusCode,
      ).toBe(400);
    });

    it('sorts and paginates deterministically', async () => {
      await populate();
      const page1 = (await api.get('/api/transactions?pageSize=3', alex)).json();
      const page2 = (await api.get('/api/transactions?pageSize=3&page=2', alex)).json();
      expect(page1.total).toBe(4);
      expect(page1.items.map((i: { description: string }) => i.description)).toEqual([
        'Taxi home',
        'October rent',
        'Groceries',
      ]);
      expect(page2.items.map((i: { description: string }) => i.description)).toEqual(['Latte']);
      const byAmount = (
        await api.get('/api/transactions?sort=amount&dir=desc&pageSize=1', alex)
      ).json();
      expect(byAmount.items[0].description).toBe('October rent');
    });

    it('surfaces uncategorised transactions', async () => {
      await populate();
      const res = await api.get('/api/transactions?uncategorized=true', alex);
      expect(res.json().items.map((i: { description: string }) => i.description)).toEqual([
        'Taxi home',
      ]);
    });
  });

  // ---------------------------------------------------------------- bulk
  describe('bulk actions', () => {
    it('assigns a category to many, and refuses incompatible selections', async () => {
      const acc = await account(alex, 'Checking', { initialBalance: 100000 });
      const other = await account(alex, 'Other');
      const a = await addTx(alex, { accountId: acc.id });
      const b = await addTx(alex, { accountId: acc.id });
      const income = await addTx(alex, { accountId: acc.id, type: 'income' });
      const transfer = await addTx(alex, {
        type: 'transfer',
        accountId: acc.id,
        transferAccountId: other.id,
      });
      const groceries = await category(alex, 'Groceries');

      const ok = await api.post('/api/transactions/bulk-categorize', alex, {
        ids: [a.id, b.id],
        categoryId: groceries,
      });
      expect(ok.json().count).toBe(2);
      expect((await api.get(`/api/transactions/${a.id}`, alex)).json().categoryId).toBe(groceries);

      const mixed = await api.post('/api/transactions/bulk-categorize', alex, {
        ids: [a.id, income.id],
        categoryId: groceries,
      });
      expect(mixed.statusCode).toBe(400);
      expect(mixed.json().error.code).toBe('category_mismatch');
      const withTransfer = await api.post('/api/transactions/bulk-categorize', alex, {
        ids: [a.id, transfer.id],
        categoryId: groceries,
      });
      expect(withTransfer.statusCode).toBe(400);

      const cleared = await api.post('/api/transactions/bulk-categorize', alex, {
        ids: [a.id],
        categoryId: null,
      });
      expect(cleared.json().count).toBe(1);
    });

    it('bulk delete restores every affected balance atomically', async () => {
      const a = await account(alex, 'A', { initialBalance: 50000 });
      const b = await account(alex, 'B');
      const t1 = await addTx(alex, { accountId: a.id, amount: 1000 });
      const t2 = await addTx(alex, {
        type: 'transfer',
        accountId: a.id,
        transferAccountId: b.id,
        amount: 2000,
      });
      const res = await api.post('/api/transactions/bulk-delete', alex, { ids: [t1.id, t2.id] });
      expect(res.json().count).toBe(2);
      expect(await balance(alex, a.id)).toBe(50000);
      expect(await balance(alex, b.id)).toBe(0);
      await expectReconciled(alex);
    });

    it('a bulk delete naming a missing id changes nothing', async () => {
      const a = await account(alex, 'A', { initialBalance: 5000 });
      const t1 = await addTx(alex, { accountId: a.id, amount: 1000 });
      const res = await api.post('/api/transactions/bulk-delete', alex, {
        ids: [t1.id, 'does-not-exist'],
      });
      expect(res.statusCode).toBe(404);
      expect(await balance(alex, a.id)).toBe(4000);
    });
  });

  describe('suggestions', () => {
    it('returns the most repeated combinations first', async () => {
      const acc = await account(alex, 'Checking', { initialBalance: 100000 });
      const coffee = await category(alex, 'Coffee');
      const today = new Date().toISOString().slice(0, 10);
      for (let i = 0; i < 3; i++)
        await addTx(alex, {
          accountId: acc.id,
          categoryId: coffee,
          description: 'Latte',
          date: today,
        });
      await addTx(alex, { accountId: acc.id, description: 'One-off', date: today });
      const res = await api.get('/api/transactions/suggestions', alex);
      expect(res.json().suggestions[0]).toMatchObject({
        description: 'Latte',
        categoryId: coffee,
        count: 3,
      });
    });
  });

  // ---------------------------------------------------------------- tenancy
  describe('tenant isolation (Bea must never reach Alex’s data)', () => {
    it('hides accounts, transactions and categories, and refuses to use them', async () => {
      const acc = await account(alex, 'Alex checking', { initialBalance: 50000 });
      const alexCat = await category(alex, 'Food');
      const t = await addTx(alex, { accountId: acc.id, amount: 1000, categoryId: alexCat });
      const beaAcc = await account(bea, 'Bea checking', { initialBalance: 7000 });

      // reading
      expect((await api.get(`/api/accounts/${acc.id}`, bea)).statusCode).toBe(404);
      expect((await api.get(`/api/accounts/${acc.id}/balance-history`, bea)).statusCode).toBe(404);
      expect((await api.get(`/api/transactions/${t.id}`, bea)).statusCode).toBe(404);
      expect(
        (await api.get('/api/accounts', bea)).json().accounts.map((a: { name: string }) => a.name),
      ).toEqual(['Bea checking']);
      expect((await api.get('/api/transactions', bea)).json().total).toBe(0);
      expect((await api.get(`/api/transactions?accountId=${acc.id}`, bea)).json().total).toBe(0);
      expect((await api.get(`/api/transactions?categoryId=${alexCat}`, bea)).json().total).toBe(0);

      // writing
      expect((await api.patch(`/api/accounts/${acc.id}`, bea, { name: 'Hacked' })).statusCode).toBe(
        404,
      );
      expect((await api.delete(`/api/accounts/${acc.id}`, bea)).statusCode).toBe(404);
      expect((await api.patch(`/api/transactions/${t.id}`, bea, { amount: 1 })).statusCode).toBe(
        404,
      );
      expect((await api.delete(`/api/transactions/${t.id}`, bea)).statusCode).toBe(404);
      expect(
        (await api.patch(`/api/categories/${alexCat}`, bea, { name: 'Hacked' })).statusCode,
      ).toBe(404);
      expect((await api.delete(`/api/categories/${alexCat}`, bea)).statusCode).toBe(404);

      // using Alex's ids inside Bea's own requests
      const intoAlex = await api.post('/api/transactions', bea, tx({ accountId: acc.id }));
      expect(intoAlex.statusCode).toBe(400);
      const withAlexCat = await api.post(
        '/api/transactions',
        bea,
        tx({ accountId: beaAcc.id, categoryId: alexCat }),
      );
      expect(withAlexCat.statusCode).toBe(400);
      const transferIn = await api.post(
        '/api/transactions',
        bea,
        tx({ type: 'transfer', accountId: beaAcc.id, transferAccountId: acc.id }),
      );
      expect(transferIn.statusCode).toBe(400);
      expect(
        (await api.post('/api/transactions/bulk-delete', bea, { ids: [t.id] })).statusCode,
      ).toBe(404);
      expect(
        (
          await api.post('/api/transactions/bulk-categorize', bea, {
            ids: [t.id],
            categoryId: null,
          })
        ).statusCode,
      ).toBe(404);

      // nothing of Alex's changed
      expect(await balance(alex, acc.id)).toBe(49000);
      expect((await api.get(`/api/transactions/${t.id}`, alex)).json().amount).toBe(1000);
      expect(await balance(bea, beaAcc.id)).toBe(7000);
    });

    it('all ledger endpoints require a session', async () => {
      for (const url of [
        '/api/accounts',
        '/api/categories',
        '/api/transactions',
        '/api/transactions/suggestions',
      ]) {
        expect((await api.get(url, null)).statusCode, url).toBe(401);
      }
    });
  });
});
