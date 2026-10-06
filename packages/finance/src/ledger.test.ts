import { describe, expect, it } from 'vitest';
import {
  balanceHistory,
  deleteEffects,
  editEffects,
  ledgerEffects,
  mergeDeltas,
  recomputeBalance,
  summarizeBalances,
  validateLedgerTx,
  type LedgerTx,
} from './ledger';

const expense = (amount: number, accountId = 'chk'): LedgerTx => ({
  type: 'expense',
  accountId,
  amount,
});
const income = (amount: number, accountId = 'chk'): LedgerTx => ({
  type: 'income',
  accountId,
  amount,
});
const transfer = (amount: number, from = 'chk', to = 'sav', credited?: number): LedgerTx => ({
  type: 'transfer',
  accountId: from,
  amount,
  transferAccountId: to,
  transferAmount: credited ?? null,
});

describe('ledgerEffects', () => {
  it('income increases, expense decreases', () => {
    expect(ledgerEffects(income(500))).toEqual([{ accountId: 'chk', delta: 500 }]);
    expect(ledgerEffects(expense(500))).toEqual([{ accountId: 'chk', delta: -500 }]);
  });

  it('a transfer moves money and leaves net worth unchanged', () => {
    const effects = ledgerEffects(transfer(50000));
    expect(effects).toEqual([
      { accountId: 'chk', delta: -50000 },
      { accountId: 'sav', delta: 50000 },
    ]);
    expect(effects.reduce((sum, e) => sum + e.delta, 0)).toBe(0);
  });

  it('a cross-currency transfer credits the destination amount, not the source amount', () => {
    const effects = ledgerEffects(transfer(10000, 'usd', 'kzt', 4_700_000));
    expect(effects).toEqual([
      { accountId: 'usd', delta: -10000 },
      { accountId: 'kzt', delta: 4_700_000 },
    ]);
  });

  it('rejects zero, negative and fractional amounts (never silently wrong)', () => {
    expect(() => ledgerEffects(expense(0))).toThrow();
    expect(() => ledgerEffects(expense(-5))).toThrow();
    expect(() => ledgerEffects(expense(1.5))).toThrow();
  });

  it('rejects malformed transfers', () => {
    expect(() => ledgerEffects(transfer(100, 'a', 'a'))).toThrow(/two different/);
    expect(() => ledgerEffects({ type: 'transfer', accountId: 'a', amount: 100 })).toThrow(
      /destination/,
    );
  });
});

describe('edit and delete', () => {
  it('editing an amount applies only the difference', () => {
    expect(editEffects(expense(1000), expense(1500))).toEqual([{ accountId: 'chk', delta: -500 }]);
  });

  it('editing nothing produces no changes', () => {
    expect(editEffects(expense(1000), expense(1000))).toEqual([]);
  });

  it('changing the account moves the effect between accounts', () => {
    expect(editEffects(expense(1000, 'chk'), expense(1000, 'cash'))).toEqual([
      { accountId: 'chk', delta: 1000 },
      { accountId: 'cash', delta: -1000 },
    ]);
  });

  it('changing the type flips the sign', () => {
    expect(editEffects(expense(1000), income(1000))).toEqual([{ accountId: 'chk', delta: 2000 }]);
  });

  it('turning an expense into a transfer touches both accounts correctly', () => {
    expect(editEffects(expense(1000), transfer(1000))).toEqual(
      [
        { accountId: 'chk', delta: 0 },
        { accountId: 'sav', delta: 1000 },
      ].filter((d) => d.delta !== 0),
    );
  });

  it('deleting reverses the effect, including both sides of a transfer', () => {
    expect(deleteEffects(expense(700))).toEqual([{ accountId: 'chk', delta: 700 }]);
    expect(deleteEffects(transfer(700))).toEqual([
      { accountId: 'chk', delta: 700 },
      { accountId: 'sav', delta: -700 },
    ]);
  });

  it('a refund (income in an expense category) restores the balance', () => {
    const net = mergeDeltas([...ledgerEffects(expense(4999)), ...ledgerEffects(income(4999))]);
    expect(net).toEqual([]);
  });

  it('merge sums per account and drops zero nets', () => {
    expect(
      mergeDeltas([
        { accountId: 'a', delta: 5 },
        { accountId: 'b', delta: 3 },
        { accountId: 'a', delta: -5 },
      ]),
    ).toEqual([{ accountId: 'b', delta: 3 }]);
  });
});

describe('recomputeBalance (the cache must always equal this)', () => {
  it('opening balance plus every transaction touching the account', () => {
    const txs = [income(500000), expense(185000), transfer(100000), expense(4500, 'sav')];
    expect(recomputeBalance('chk', 100000, txs)).toBe(100000 + 500000 - 185000 - 100000);
    expect(recomputeBalance('sav', 0, txs)).toBe(100000 - 4500);
  });

  it('is unaffected by transactions on unrelated accounts', () => {
    expect(recomputeBalance('cash', 1000, [expense(999, 'chk')])).toBe(1000);
  });

  it('credit cards go negative with spending and recover with payments (transfers in)', () => {
    const card = [expense(82000, 'card')];
    expect(recomputeBalance('card', 0, card)).toBe(-82000);
    const payment = transfer(50000, 'chk', 'card');
    expect(recomputeBalance('card', 0, [...card, payment])).toBe(-32000);
  });

  it('a negative opening balance is honoured', () => {
    expect(recomputeBalance('card', -120000, [])).toBe(-120000);
  });
});

describe('balanceHistory', () => {
  it('reports closing balance per active day, grouping same-day transactions', () => {
    const history = balanceHistory('chk', 1000, [
      { ...expense(200), date: '2026-10-02' },
      { ...income(5000), date: '2026-10-01' },
      { ...expense(300), date: '2026-10-02' },
    ]);
    expect(history).toEqual([
      { date: '2026-10-01', balance: 6000 },
      { date: '2026-10-02', balance: 5500 },
    ]);
  });

  it('ignores other accounts', () => {
    expect(balanceHistory('x', 0, [{ ...expense(5), date: '2026-01-01' }])).toEqual([]);
  });
});

describe('validateLedgerTx', () => {
  const base = { currency: 'USD' as const };
  const ctx = { accountCurrency: 'USD' as const };

  it('accepts a clean expense', () => {
    expect(
      validateLedgerTx({ ...base, ...expense(100) }, { ...ctx, categoryType: 'expense' }),
    ).toEqual([]);
  });

  it('flags category type mismatches', () => {
    const issues = validateLedgerTx(
      { ...base, ...expense(100) },
      { ...ctx, categoryType: 'income' },
    );
    expect(issues.map((i) => i.field)).toEqual(['categoryId']);
  });

  it('flags currency differing from the account', () => {
    const issues = validateLedgerTx({ currency: 'EUR', ...expense(100) }, ctx);
    expect(issues[0]?.field).toBe('currency');
  });

  it('transfers need a different destination and no category', () => {
    expect(validateLedgerTx({ ...base, ...transfer(100, 'a', 'a') }, ctx)[0]?.field).toBe(
      'transferAccountId',
    );
    expect(
      validateLedgerTx(
        { ...base, ...transfer(100), hasCategory: true },
        { ...ctx, transferAccountCurrency: 'USD' },
      ),
    ).toEqual([{ field: 'categoryId', message: 'Transfers do not have a category.' }]);
  });

  it('same-currency transfers must credit the same amount', () => {
    const issues = validateLedgerTx(
      { ...base, ...transfer(100, 'a', 'b', 90) },
      { ...ctx, transferAccountCurrency: 'USD' },
    );
    expect(issues.map((i) => i.field)).toEqual(['transferAmount']);
  });

  it('cross-currency transfers must state what arrives', () => {
    const issues = validateLedgerTx(
      { ...base, ...transfer(100, 'a', 'b') },
      { ...ctx, transferAccountCurrency: 'KZT' },
    );
    expect(issues.map((i) => i.field)).toEqual(['transferAmount']);
    expect(
      validateLedgerTx(
        { ...base, ...transfer(100, 'a', 'b', 47000) },
        { ...ctx, transferAccountCurrency: 'KZT' },
      ),
    ).toEqual([]);
  });

  it('a refund is income in an expense category, and only income can be a refund', () => {
    const refund = { ...base, ...income(2500), isRefund: true };
    expect(validateLedgerTx(refund, { ...ctx, categoryType: 'expense' })).toEqual([]);
    expect(
      validateLedgerTx(refund, { ...ctx, categoryType: 'income' }).map((i) => i.field),
    ).toEqual(['categoryId']);
    expect(
      validateLedgerTx({ ...base, ...expense(2500), isRefund: true }, ctx).map((i) => i.field),
    ).toEqual(['isRefund']);
  });

  it('income and expense cannot carry a destination account', () => {
    const issues = validateLedgerTx({ ...base, ...expense(100), transferAccountId: 'x' }, ctx);
    expect(issues.map((i) => i.field)).toEqual(['transferAccountId']);
  });
});

describe('summarizeBalances (net worth)', () => {
  it('subtracts credit card debt instead of treating it as wealth', () => {
    const [usd] = summarizeBalances([
      { currency: 'USD', balance: 24000 }, // cash
      { currency: 'USD', balance: 432000 }, // checking
      { currency: 'USD', balance: 850000 }, // savings
      { currency: 'USD', balance: -82000 }, // credit card
    ]);
    expect(usd).toEqual({ currency: 'USD', assets: 1_306_000, debts: 82000, netWorth: 1_224_000 });
  });

  it('keeps currencies separate', () => {
    const totals = summarizeBalances([
      { currency: 'USD', balance: 1000 },
      { currency: 'KZT', balance: 500000 },
    ]);
    expect(totals.map((t) => t.currency)).toEqual(['KZT', 'USD']);
  });

  it('skips empty archived accounts but counts archived accounts that still hold money', () => {
    expect(summarizeBalances([{ currency: 'USD', balance: 0, isArchived: true }])).toEqual([]);
    expect(
      summarizeBalances([{ currency: 'USD', balance: 500, isArchived: true }])[0]?.netWorth,
    ).toBe(500);
  });

  it('a transfer between own accounts never changes net worth', () => {
    const before = [
      { id: 'chk', currency: 'USD' as const, balance: 100000 },
      { id: 'sav', currency: 'USD' as const, balance: 0 },
    ];
    const after = before.map((a) => {
      const effect = ledgerEffects(transfer(40000)).find((e) => e.accountId === a.id);
      return { ...a, balance: a.balance + (effect?.delta ?? 0) };
    });
    expect(summarizeBalances(after)[0]?.netWorth).toBe(summarizeBalances(before)[0]?.netWorth);
  });

  it('paying a credit card from checking leaves net worth unchanged but lowers debt', () => {
    const [before] = summarizeBalances([
      { currency: 'USD', balance: 100000 },
      { currency: 'USD', balance: -82000 },
    ]);
    const [after] = summarizeBalances([
      { currency: 'USD', balance: 18000 },
      { currency: 'USD', balance: 0 },
    ]);
    expect(after?.netWorth).toBe(before?.netWorth);
    expect(after?.debts).toBe(0);
  });
});
