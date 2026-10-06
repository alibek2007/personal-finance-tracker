import { describe, expect, it } from 'vitest';
import { generateInsights, type InsightInput } from './insights';
import { buildBuckets, rangeForPreset } from './periods';
import {
  cashFlow,
  categoryBreakdown,
  changeBp,
  inCurrency,
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
  { id: 'groc', name: 'Groceries', color: '#b98a2e', parentId: 'food' },
  { id: 'rent', name: 'Rent', color: '#1f4e5a', parentId: null },
  { id: 'shop', name: 'Shopping', color: '#b2432b', parentId: null },
  { id: 'salary', name: 'Salary', color: '#2e6b4b', parentId: null },
];

const OCT = { from: '2026-10-01', to: '2026-10-31' };

describe('summarize', () => {
  it('income, spending, savings and savings rate', () => {
    const s = summarize(
      [
        tx({ type: 'income', amount: 480000, categoryId: 'salary' }),
        tx({ amount: 185000, categoryId: 'rent' }),
        tx({ amount: 108000, categoryId: 'food' }),
      ],
      OCT,
    );
    expect(s).toMatchObject({ income: 480000, spent: 293000, saved: 187000, savingsRateBp: 3896 });
  });

  it('transfers are neither income nor spending', () => {
    const s = summarize(
      [tx({ type: 'transfer', amount: 50000 }), tx({ type: 'income', amount: 1000 })],
      OCT,
    );
    expect(s).toMatchObject({ income: 1000, spent: 0, transactionCount: 1 });
  });

  it('a refund reduces spending and is not counted as income', () => {
    const s = summarize(
      [
        tx({ type: 'income', amount: 100000 }),
        tx({ amount: 4999, categoryId: 'shop' }),
        tx({ type: 'income', amount: 4999, isRefund: true, categoryId: 'shop' }),
      ],
      OCT,
    );
    expect(s).toMatchObject({ income: 100000, spent: 0, refunds: 4999, saved: 100000 });
  });

  it('only counts the requested dates (inclusive at both ends)', () => {
    const s = summarize(
      [
        tx({ date: '2026-09-30' }),
        tx({ date: '2026-10-01' }),
        tx({ date: '2026-10-31' }),
        tx({ date: '2026-11-01' }),
      ],
      OCT,
    );
    expect(s.spent).toBe(2000);
  });

  it('has no savings rate when there is no income, and handles overspending', () => {
    expect(summarize([tx({ amount: 5000 })], OCT)).toMatchObject({
      savingsRateBp: null,
      saved: -5000,
    });
    expect(
      summarize([tx({ type: 'income', amount: 1000 }), tx({ amount: 1500 })], OCT).savingsRateBp,
    ).toBe(-5000);
  });

  it('empty input is all zeros, not NaN', () => {
    expect(summarize([], OCT)).toEqual({
      income: 0,
      spent: 0,
      refunds: 0,
      saved: 0,
      savingsRateBp: null,
      transactionCount: 0,
    });
  });
});

describe('inCurrency', () => {
  it('separates other currencies instead of summing them', () => {
    const { counted, excludedCurrencies } = inCurrency(
      [tx({}), tx({ currency: 'KZT', amount: 999999 }), tx({ type: 'transfer' })],
      'USD',
    );
    expect(counted).toHaveLength(1);
    expect(excludedCurrencies).toEqual(['KZT']);
  });
});

describe('cashFlow', () => {
  const buckets = buildBuckets({ from: '2026-10-01', to: '2026-10-05' }, 'day');

  it('zero-fills days with no activity', () => {
    const points = cashFlow([tx({ date: '2026-10-03', amount: 700 })], buckets);
    expect(points.map((p) => p.expenses)).toEqual([0, 0, 700, 0, 0]);
    expect(points).toHaveLength(5);
  });

  it('income and expenses on the same day; net is their difference', () => {
    const [p] = cashFlow(
      [
        tx({ type: 'income', date: '2026-10-01', amount: 5000 }),
        tx({ date: '2026-10-01', amount: 1200 }),
      ],
      buckets,
    );
    expect(p).toMatchObject({ income: 5000, expenses: 1200, net: 3800 });
  });

  it('refunds reduce that bucket’s expenses; transfers and out-of-range rows are ignored', () => {
    const points = cashFlow(
      [
        tx({ date: '2026-10-02', amount: 3000 }),
        tx({ type: 'income', isRefund: true, date: '2026-10-02', amount: 1000 }),
        tx({ type: 'transfer', date: '2026-10-02', amount: 9999 }),
        tx({ date: '2026-09-30', amount: 777 }),
        tx({ date: '2026-10-06', amount: 888 }),
      ],
      buckets,
    );
    expect(points[1]).toMatchObject({ income: 0, expenses: 2000, net: -2000 });
    expect(points.reduce((s, p) => s + p.expenses, 0)).toBe(2000);
  });

  it('totals equal the summary for the same range (one source of truth)', () => {
    const txs = [
      tx({ type: 'income', date: '2026-10-01', amount: 480000 }),
      tx({ date: '2026-10-01', amount: 185000 }),
      tx({ date: '2026-10-04', amount: 4321 }),
      tx({ type: 'income', isRefund: true, date: '2026-10-05', amount: 321 }),
    ];
    const range = { from: '2026-10-01', to: '2026-10-05' };
    const points = cashFlow(txs, buckets);
    const s = summarize(txs, range);
    expect(points.reduce((a, p) => a + p.income, 0)).toBe(s.income);
    expect(points.reduce((a, p) => a + p.expenses, 0)).toBe(s.spent);
  });

  it('works for monthly buckets across a year boundary', () => {
    const monthly = buildBuckets({ from: '2025-11-15', to: '2026-01-10' }, 'month');
    const points = cashFlow(
      [tx({ date: '2025-12-31', amount: 1 }), tx({ date: '2026-01-01', amount: 2 })],
      monthly,
    );
    expect(points.map((p) => p.expenses)).toEqual([0, 1, 2]);
    const big = buildBuckets(rangeForPreset('1y', '2026-10-05'), 'month');
    expect(big).toHaveLength(13);
  });
});

describe('categoryBreakdown', () => {
  it('rolls subcategories up to their parent and lists them as children', () => {
    const { slices, total } = categoryBreakdown(
      [
        tx({ amount: 450, categoryId: 'coffee' }),
        tx({ amount: 8400, categoryId: 'groc' }),
        tx({ amount: 185000, categoryId: 'rent' }),
        tx({ amount: 100, categoryId: 'food' }),
      ],
      cats,
    );
    expect(total).toBe(193950);
    expect(slices.map((s) => [s.name, s.amount])).toEqual([
      ['Rent', 185000],
      ['Food', 8950],
    ]);
    expect(slices[1]!.children.map((c) => [c.name, c.amount])).toEqual([
      ['Groceries', 8400],
      ['Coffee', 450],
      ['Food', 100],
    ]);
  });

  it('shares are in basis points and add up to about 100%', () => {
    const { slices } = categoryBreakdown(
      [
        tx({ amount: 3333, categoryId: 'rent' }),
        tx({ amount: 3333, categoryId: 'shop' }),
        tx({ amount: 3334, categoryId: 'food' }),
      ],
      cats,
    );
    const sum = slices.reduce((s, x) => s + x.shareBp, 0);
    expect(Math.abs(sum - 10000)).toBeLessThanOrEqual(2);
  });

  it('refunds reduce their category, and a fully refunded category disappears', () => {
    const { slices } = categoryBreakdown(
      [
        tx({ amount: 4999, categoryId: 'shop' }),
        tx({ type: 'income', isRefund: true, amount: 4999, categoryId: 'shop' }),
        tx({ amount: 1000, categoryId: 'rent' }),
      ],
      cats,
    );
    expect(slices.map((s) => s.name)).toEqual(['Rent']);
  });

  it('ordinary income and transfers never appear as spending', () => {
    const { slices, total } = categoryBreakdown(
      [
        tx({ type: 'income', amount: 480000, categoryId: 'salary' }),
        tx({ type: 'transfer', amount: 5 }),
      ],
      cats,
    );
    expect(slices).toEqual([]);
    expect(total).toBe(0);
  });

  it('keeps uncategorised spending visible and labelled', () => {
    const { slices } = categoryBreakdown([tx({ amount: 700, categoryId: null })], cats);
    expect(slices[0]).toMatchObject({
      categoryId: null,
      name: 'Uncategorised',
      amount: 700,
      shareBp: 10000,
    });
  });

  it('is stable when amounts tie (sorted by name)', () => {
    const { slices } = categoryBreakdown(
      [tx({ amount: 5, categoryId: 'shop' }), tx({ amount: 5, categoryId: 'rent' })],
      cats,
    );
    expect(slices.map((s) => s.name)).toEqual(['Rent', 'Shopping']);
  });
});

describe('changeBp', () => {
  it('computes percentage change, with null when there is no baseline', () => {
    expect(changeBp(118, 100)).toBe(1800);
    expect(changeBp(88, 100)).toBe(-1200);
    expect(changeBp(5, 0)).toBeNull();
    expect(changeBp(0, 100)).toBe(-10000);
  });
});

describe('generateInsights', () => {
  const emptySummary = {
    income: 0,
    spent: 0,
    refunds: 0,
    saved: 0,
    savingsRateBp: null,
    transactionCount: 0,
  };
  const slice = (id: string, name: string, amount: number, shareBp: number) => ({
    categoryId: id,
    name,
    color: '#000',
    amount,
    shareBp,
    count: 3,
    children: [],
  });
  const base = (): InsightInput => ({
    currency: 'USD',
    locale: 'en-US',
    daysElapsed: 10,
    daysInMonth: 31,
    thisMonth: {
      summary: {
        ...emptySummary,
        income: 480000,
        spent: 150000,
        saved: 330000,
        transactionCount: 9,
      },
      slices: [
        slice('food', 'Food', 59000, 3933),
        slice('rent', 'Rent', 70000, 4667),
        slice('shop', 'Shopping', 21000, 1400),
      ],
    },
    lastSamePeriod: {
      summary: {
        ...emptySummary,
        income: 480000,
        spent: 120000,
        saved: 360000,
        transactionCount: 9,
      },
      slices: [slice('food', 'Food', 50000, 4166), slice('rent', 'Rent', 70000, 5833)],
    },
    lastFull: {
      ...emptySummary,
      income: 480000,
      spent: 293000,
      saved: 187000,
      transactionCount: 30,
    },
    lastRemainder: { income: 0, spent: 143000 },
  });

  it('says nothing early in the month (too little signal)', () => {
    expect(
      generateInsights({ ...base(), daysElapsed: 3 }).filter((i) => i.id !== 'top-category-rent'),
    ).toEqual([]);
  });

  it('adds up subscriptions in plain words, and is silent without any', () => {
    const withSubs = (count: number, monthly: number, yearly: number) =>
      generateInsights({
        ...base(),
        daysElapsed: 3, // a quiet start of the month: only standing facts remain
        subscriptions: { count, monthly, yearly },
      }).find((i) => i.id === 'subscriptions');
    expect(withSubs(4, 4697, 56364)?.text).toBe(
      'Your subscriptions cost about $46.97 a month ($563.64 a year).',
    );
    expect(withSubs(1, 2999, 35988)?.text).toBe(
      'Your subscription costs about $29.99 a month ($359.88 a year).',
    );
    expect(withSubs(1, 299, 3588)).toBeUndefined(); // too small to be worth a line
    expect(withSubs(0, 0, 0)).toBeUndefined();
    expect(
      generateInsights({ ...base(), daysElapsed: 3 }).some((i) => i.id === 'subscriptions'),
    ).toBe(false);
  });

  it('says nothing at all for a brand-new user', () => {
    const empty: InsightInput = {
      ...base(),
      thisMonth: { summary: emptySummary, slices: [] },
      lastSamePeriod: { summary: emptySummary, slices: [] },
      lastFull: emptySummary,
      lastRemainder: { income: 0, spent: 0 },
    };
    expect(generateInsights(empty)).toEqual([]);
  });

  it('projects savings from last month’s remainder and states its assumption', () => {
    const insights = generateInsights(base());
    const projection = insights.find((i) => i.id === 'projected-savings')!;
    // saved so far 3,300 + (0 income - 1,430 spend) remaining last month
    expect(projection.text).toBe(
      "If the rest of the month looks like last month, you'll save about $1,870.",
    );
    expect(projection.tone).toBe('positive');
  });

  it('flags a projected shortfall', () => {
    const input = base();
    input.lastRemainder = { income: 0, spent: 500000 };
    const projection = generateInsights(input).find((i) => i.id === 'projected-savings')!;
    expect(projection.tone).toBe('negative');
    expect(projection.text).toContain('short');
  });

  it('compares total pace against the same point last month, with real numbers', () => {
    const pace = generateInsights(base()).find((i) => i.id === 'spending-pace')!;
    expect(pace.text).toBe("You've spent 25% more than at this point last month ($300 more).");
    expect(pace.tone).toBe('negative');
  });

  it('names the category that moved the most', () => {
    const trend = generateInsights(base()).find((i) => i.id === 'category-trend-food')!;
    expect(trend.text).toBe(
      'You spent 18% more on Food so far this month than at this point last month.',
    );
    expect(trend.categoryId).toBe('food');
  });

  it('ignores tiny changes (percent big, dollars small)', () => {
    const input = base();
    input.thisMonth.slices = [
      slice('food', 'Food', 1500, 5000),
      slice('rent', 'Rent', 70000, 5000),
    ];
    input.lastSamePeriod.slices = [
      slice('food', 'Food', 500, 1000),
      slice('rent', 'Rent', 70000, 9000),
    ];
    input.thisMonth.summary.spent = 71500;
    input.lastSamePeriod.summary.spent = 70500;
    const ids = generateInsights(input).map((i) => i.id);
    expect(ids).not.toContain('category-trend-food');
    expect(ids).not.toContain('spending-pace');
  });

  it('good news counts too: spending less is positive', () => {
    const input = base();
    input.thisMonth.summary.spent = 80000;
    const pace = generateInsights(input).find((i) => i.id === 'spending-pace')!;
    expect(pace.tone).toBe('positive');
    expect(pace.text).toContain('less');
  });

  it('flags a category that dominates spending', () => {
    const input = base();
    const top = generateInsights(input).find((i) => i.id === 'top-category-rent')!;
    expect(top.text).toBe('Rent is 47% of your spending this month ($700).');
  });

  it('does not call out a dominant category in the first days of a month (rent lands on the 1st)', () => {
    const input = base();
    input.daysElapsed = 6;
    expect(generateInsights(input).map((i) => i.id)).not.toContain('top-category-rent');
  });

  it('never returns more than four, strongest first', () => {
    const insights = generateInsights(base());
    expect(insights.length).toBeLessThanOrEqual(4);
    expect(insights[0]!.id).toBe('projected-savings');
  });

  it('uses the currency’s own decimals for thresholds (JPY has none)', () => {
    const input = base();
    input.currency = 'JPY';
    // 20 yen is the threshold, so a 300-yen difference is meaningful
    expect(generateInsights(input).some((i) => i.id === 'spending-pace')).toBe(true);
  });
});
