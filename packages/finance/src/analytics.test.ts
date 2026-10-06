import { describe, expect, it } from 'vitest';
import { balanceSeries } from './ledger';
import { buildBuckets, previousRange } from './periods';
import {
  cashFlow,
  cumulativeSeries,
  monthlyComparison,
  spendingTrend,
  summarize,
  type CategoryMeta,
  type ReportTx,
} from './reports';

const tx = (over: Partial<ReportTx>): ReportTx => ({
  type: 'expense',
  amount: 1000,
  currency: 'USD',
  date: '2026-10-02',
  categoryId: null,
  isRefund: false,
  ...over,
});
const cats: CategoryMeta[] = [
  { id: 'food', name: 'Food', color: '#b98a2e', parentId: null },
  { id: 'coffee', name: 'Coffee', color: '#b98a2e', parentId: 'food' },
  { id: 'rent', name: 'Rent', color: '#1f4e5a', parentId: null },
  { id: 'shop', name: 'Shopping', color: '#b2432b', parentId: null },
  { id: 'fun', name: 'Fun', color: '#85687a', parentId: null },
  { id: 'trip', name: 'Travel', color: '#5b6b84', parentId: null },
  { id: 'gym', name: 'Health', color: '#6f8f72', parentId: null },
];

describe('previousRange', () => {
  it('is the same length, ending the day before', () => {
    expect(previousRange({ from: '2026-10-01', to: '2026-10-31' })).toEqual({
      from: '2026-08-31',
      to: '2026-09-30',
    });
    expect(previousRange({ from: '2026-10-09', to: '2026-10-15' })).toEqual({
      from: '2026-10-02',
      to: '2026-10-08',
    });
    expect(previousRange({ from: '2024-03-01', to: '2024-03-01' })).toEqual({
      from: '2024-02-29',
      to: '2024-02-29',
    });
  });
});

describe('spendingTrend', () => {
  const buckets = buildBuckets({ from: '2026-10-01', to: '2026-10-21' }, 'week');

  it('splits each bucket by top-level category and rolls subcategories up', () => {
    const { series, points } = spendingTrend(
      [
        tx({ amount: 450, categoryId: 'coffee', date: '2026-10-02' }),
        tx({ amount: 8000, categoryId: 'food', date: '2026-10-03' }),
        tx({ amount: 185000, categoryId: 'rent', date: '2026-10-01' }),
        tx({ amount: 3000, categoryId: 'food', date: '2026-10-15' }),
      ],
      cats,
      buckets,
    );
    expect(series.map((s) => s.name)).toEqual(['Rent', 'Food']);
    expect(points[0]!.values).toEqual({ rent: 185000, food: 8450 });
    expect(points[2]!.values).toEqual({ rent: 0, food: 3000 });
  });

  it('keeps the biggest five and groups the rest, and the totals still add up', () => {
    const txs = ['food', 'rent', 'shop', 'fun', 'trip', 'gym'].map((id, i) =>
      tx({ amount: (i + 1) * 1000, categoryId: id }),
    );
    const { series, points } = spendingTrend(txs, cats, buckets);
    expect(series).toHaveLength(6);
    expect(series.at(-1)).toMatchObject({ key: 'other', name: 'Everything else' });
    expect(series.slice(0, 5).map((s) => s.name)).not.toContain('Food'); // the smallest got folded in
    const stacked = Object.values(points[0]!.values).reduce((a, b) => a + b, 0);
    expect(stacked).toBe(points[0]!.total);
    expect(points.reduce((s, p) => s + p.total, 0)).toBe(21000);
  });

  it('total per bucket equals the cash-flow expenses (one source of truth), refunds included', () => {
    const txs = [
      tx({ amount: 5000, categoryId: 'shop', date: '2026-10-03' }),
      tx({ type: 'income', isRefund: true, amount: 1500, categoryId: 'shop', date: '2026-10-04' }),
      tx({ amount: 700, categoryId: null, date: '2026-10-10' }),
      tx({ type: 'income', amount: 99999, date: '2026-10-05' }),
      tx({ type: 'transfer', amount: 55555, date: '2026-10-05' }),
    ];
    const trend = spendingTrend(txs, cats, buckets);
    const flow = cashFlow(txs, buckets);
    expect(trend.points.map((p) => p.total)).toEqual(flow.map((p) => p.expenses));
  });

  it('shows uncategorised spending under its own name', () => {
    const { series } = spendingTrend([tx({ amount: 900, categoryId: null })], cats, buckets);
    expect(series[0]).toMatchObject({ key: '__none', name: 'Uncategorised' });
  });

  it('is empty (not broken) with no spending', () => {
    const { series, points } = spendingTrend([], cats, buckets);
    expect(series).toEqual([]);
    expect(points.every((p) => p.total === 0)).toBe(true);
  });
});

describe('monthlyComparison', () => {
  const txs: ReportTx[] = [
    tx({ type: 'income', amount: 480000, date: '2026-08-01' }),
    tx({ amount: 200000, date: '2026-08-05' }),
    tx({ type: 'income', amount: 480000, date: '2026-09-01' }),
    tx({ amount: 250000, date: '2026-09-05' }),
    tx({ amount: 10000, date: '2026-09-20' }),
    tx({ type: 'income', amount: 480000, date: '2026-10-01' }),
    tx({ amount: 300000, date: '2026-10-03' }),
  ];

  it('returns the requested number of months oldest first, with month totals', () => {
    const rows = monthlyComparison(txs, '2026-10-05', 3);
    expect(rows.map((r) => r.month)).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(rows[1]).toMatchObject({ income: 480000, spent: 260000, saved: 220000, partial: false });
    expect(rows[0]).toMatchObject({ spent: 200000 });
  });

  it('changes compare with the previous full month', () => {
    const sept = monthlyComparison(txs, '2026-10-05', 3)[1]!;
    expect(sept.spentChangeBp).toBe(3000); // 260,000 vs 200,000
    expect(sept.incomeChangeBp).toBe(0);
  });

  it('the current month is partial and compared with the same days of last month', () => {
    const oct = monthlyComparison(txs, '2026-10-05', 3)[2]!;
    expect(oct).toMatchObject({ partial: true, to: '2026-10-05', spent: 300000 });
    // Sept 1-5 had 250,000 of spending (the 20th is outside the first 5 days)
    expect(oct.spentChangeBp).toBe(2000);
  });

  it('handles a short previous month and the year boundary', () => {
    const rows = monthlyComparison(
      [tx({ amount: 100, date: '2027-01-02' }), tx({ amount: 50, date: '2026-12-02' })],
      '2027-01-31',
      2,
    );
    expect(rows.map((r) => r.month)).toEqual(['2026-12', '2027-01']);
    expect(rows[1]!.spentChangeBp).toBe(10000); // 100 vs 50
    const feb = monthlyComparison([tx({ amount: 100, date: '2026-01-31' })], '2026-03-31', 1)[0]!;
    expect(feb.partial).toBe(false); // 31 March is the whole month
    expect(feb.spentChangeBp).toBeNull(); // nothing in February to compare with
  });

  it('is zero-filled for months with no activity', () => {
    const rows = monthlyComparison([], '2026-10-05', 2);
    expect(rows.every((r) => r.income === 0 && r.spent === 0 && r.savingsRateBp === null)).toBe(
      true,
    );
  });

  it('month totals agree with summarize for the same dates', () => {
    const rows = monthlyComparison(txs, '2026-10-31', 2);
    expect(rows[0]!.spent).toBe(summarize(txs, { from: '2026-09-01', to: '2026-09-30' }).spent);
  });
});

describe('cumulativeSeries', () => {
  it('samples the running total at each date, inclusive', () => {
    expect(
      cumulativeSeries(
        [
          { date: '2026-09-01', amount: 100 },
          { date: '2026-10-01', amount: 50 },
          { date: '2026-10-01', amount: -20 },
        ],
        ['2026-08-31', '2026-09-01', '2026-09-30', '2026-10-01'],
      ),
    ).toEqual([0, 100, 100, 130]);
  });

  it('is unaffected by input order and empty input', () => {
    expect(
      cumulativeSeries(
        [
          { date: '2026-10-01', amount: 5 },
          { date: '2026-09-01', amount: 7 },
        ],
        ['2026-10-02'],
      ),
    ).toEqual([12]);
    expect(cumulativeSeries([], ['2026-10-02'])).toEqual([0]);
  });
});

describe('balanceSeries', () => {
  const accounts = [
    { id: 'chk', initialBalance: 100000 },
    { id: 'sav', initialBalance: 0 },
    { id: 'card', initialBalance: -20000 },
  ];
  const t = (
    type: 'income' | 'expense' | 'transfer',
    amount: number,
    date: string,
    accountId: string,
    to?: string,
  ) => ({
    type,
    amount,
    date,
    accountId,
    transferAccountId: to ?? null,
    transferAmount: null,
  });

  it('tracks each balance and the net worth total through time', () => {
    const series = balanceSeries(
      accounts,
      [
        t('income', 50000, '2026-10-02', 'chk'),
        t('transfer', 30000, '2026-10-03', 'chk', 'sav'),
        t('expense', 5000, '2026-10-04', 'card'),
      ],
      ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'],
    );
    expect(series.map((p) => p.total)).toEqual([80000, 130000, 130000, 125000]);
    expect(series[2]!.byAccount).toEqual({ chk: 120000, sav: 30000, card: -20000 });
    expect(series[3]!.byAccount.card).toBe(-25000); // debt grows
  });

  it('a transfer between own accounts never changes the total', () => {
    const series = balanceSeries(
      accounts,
      [t('transfer', 40000, '2026-10-02', 'chk', 'sav')],
      ['2026-10-01', '2026-10-02'],
    );
    expect(series[0]!.total).toBe(series[1]!.total);
  });

  it('paying a card from checking lowers debt but not net worth', () => {
    const series = balanceSeries(
      accounts,
      [t('transfer', 20000, '2026-10-02', 'chk', 'card')],
      ['2026-10-01', '2026-10-02'],
    );
    expect(series[1]!.byAccount.card).toBe(0);
    expect(series[1]!.total).toBe(series[0]!.total);
  });

  it('transactions after the last sample date, or on unknown accounts, are ignored', () => {
    const series = balanceSeries(
      [accounts[0]!],
      [t('expense', 999, '2026-11-01', 'chk'), t('expense', 5, '2026-10-01', 'ghost')],
      ['2026-10-31'],
    );
    expect(series[0]!.total).toBe(100000);
  });

  it('final balance equals the account’s recomputed balance', () => {
    const txs = [
      t('income', 1000, '2026-10-01', 'chk'),
      t('expense', 250, '2026-10-02', 'chk'),
      t('transfer', 100, '2026-10-02', 'sav', 'chk'),
    ];
    const last = balanceSeries(accounts, txs, ['2026-12-31']).at(-1)!;
    expect(last.byAccount.chk).toBe(100000 + 1000 - 250 + 100);
  });
});
