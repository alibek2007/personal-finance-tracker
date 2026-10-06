import { z } from 'zod';
import { addMonths } from '@pfm/finance';
import { currencySchema, idSchema, isoDateSchema, minorUnitsSchema } from './common';

export const rangePresetSchema = z.enum(['7d', '30d', '3m', '6m', '1y', 'custom']);
export type RangePresetInput = z.infer<typeof rangePresetSchema>;

/** Shared by cash-flow and category endpoints (and the future analytics screen). */
export const analyticsQuerySchema = z
  .object({
    range: rangePresetSchema.default('30d'),
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    accountId: idSchema.optional(),
    /** Includes subcategories. */
    categoryId: idSchema.optional(),
    type: z.enum(['income', 'expense']).optional(),
  })
  .superRefine((q, ctx) => {
    if (q.range !== 'custom') return;
    if (!q.from || !q.to) {
      ctx.addIssue({
        code: 'custom',
        path: ['from'],
        message: 'Choose a start and end date for a custom range',
      });
      return;
    }
    if (q.from > q.to) {
      ctx.addIssue({
        code: 'custom',
        path: ['from'],
        message: 'The start date must be before the end date',
      });
    } else if (q.to > addMonths(q.from, 60)) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'Custom ranges can span at most 5 years',
      });
    }
  });
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

const nullableBp = z.number().int().nullable();

export const insightSchema = z.object({
  id: z.string(),
  tone: z.enum(['positive', 'negative', 'neutral']),
  text: z.string(),
  categoryId: z.string().nullish(),
});

const periodSummary = z.object({
  income: minorUnitsSchema,
  spent: minorUnitsSchema,
  saved: minorUnitsSchema,
  savingsRateBp: nullableBp,
});

export const overviewSchema = z.object({
  currency: currencySchema,
  /** The user's local calendar date used for every calculation below. */
  today: isoDateSchema,
  /** Net worth in `currency` (debts subtracted). */
  totalBalance: minorUnitsSchema,
  /** Currencies the user also holds; excluded from every total here, never silently converted. */
  otherCurrencies: z.array(currencySchema),
  hasTransactions: z.boolean(),
  month: periodSummary.extend({
    from: isoDateSchema,
    to: isoDateSchema,
    daysElapsed: z.number().int(),
    daysInMonth: z.number().int(),
  }),
  /** The first N days of last month, for a like-for-like comparison. */
  previous: periodSummary.extend({ from: isoDateSchema, to: isoDateSchema }),
  changes: z.object({ incomeBp: nullableBp, spentBp: nullableBp, savedBp: nullableBp }),
  insights: z.array(insightSchema),
});
export type OverviewDto = z.infer<typeof overviewSchema>;

export const cashFlowSchema = z.object({
  currency: currencySchema,
  from: isoDateSchema,
  to: isoDateSchema,
  unit: z.enum(['day', 'week', 'month']),
  points: z.array(
    z.object({
      start: isoDateSchema,
      end: isoDateSchema,
      income: minorUnitsSchema,
      expenses: minorUnitsSchema,
      net: minorUnitsSchema,
    }),
  ),
  totals: periodSummary,
  excludedCurrencies: z.array(currencySchema),
});
export type CashFlowDto = z.infer<typeof cashFlowSchema>;

export const categorySliceSchema = z.object({
  categoryId: z.string().nullable(),
  name: z.string(),
  color: z.string(),
  amount: minorUnitsSchema,
  shareBp: z.number().int(),
  count: z.number().int(),
  children: z.array(
    z.object({
      categoryId: z.string().nullable(),
      name: z.string(),
      amount: minorUnitsSchema,
      count: z.number().int(),
    }),
  ),
});

export const categoryBreakdownSchema = z.object({
  currency: currencySchema,
  from: isoDateSchema,
  to: isoDateSchema,
  total: minorUnitsSchema,
  slices: z.array(categorySliceSchema),
  excludedCurrencies: z.array(currencySchema),
});
export type CategoryBreakdownDto = z.infer<typeof categoryBreakdownSchema>;

// ------------------------------------------------------------------ the Analytics screen

export const summarySchema = z.object({
  currency: currencySchema,
  current: periodSummary.extend({ from: isoDateSchema, to: isoDateSchema }),
  /** The period of equal length immediately before. */
  previous: periodSummary.extend({ from: isoDateSchema, to: isoDateSchema }),
  changes: z.object({ incomeBp: nullableBp, spentBp: nullableBp, savedBp: nullableBp }),
  /** The date of the user's earliest transaction. A comparison period starting before it is only partly covered. */
  dataStartsOn: isoDateSchema.nullable(),
  excludedCurrencies: z.array(currencySchema),
});
export type SummaryDto = z.infer<typeof summarySchema>;

export const spendingTrendSchema = z.object({
  currency: currencySchema,
  from: isoDateSchema,
  to: isoDateSchema,
  unit: z.enum(['day', 'week', 'month']),
  series: z.array(z.object({ key: z.string(), name: z.string(), color: z.string() })),
  points: z.array(
    z.object({
      start: isoDateSchema,
      end: isoDateSchema,
      total: minorUnitsSchema,
      values: z.record(z.string(), minorUnitsSchema),
    }),
  ),
  excludedCurrencies: z.array(currencySchema),
});
export type SpendingTrendDto = z.infer<typeof spendingTrendSchema>;

export const monthlyQuerySchema = z.object({
  months: z.coerce.number().int().min(2).max(24).default(12),
  accountId: idSchema.optional(),
  categoryId: idSchema.optional(),
  type: z.enum(['income', 'expense']).optional(),
});
export type MonthlyQuery = z.infer<typeof monthlyQuerySchema>;

export const monthlySchema = z.object({
  currency: currencySchema,
  months: z.array(
    z.object({
      month: z.string(),
      from: isoDateSchema,
      to: isoDateSchema,
      partial: z.boolean(),
      income: minorUnitsSchema,
      spent: minorUnitsSchema,
      saved: minorUnitsSchema,
      savingsRateBp: nullableBp,
      incomeChangeBp: nullableBp,
      spentChangeBp: nullableBp,
      savedChangeBp: nullableBp,
    }),
  ),
  excludedCurrencies: z.array(currencySchema),
});
export type MonthlyDto = z.infer<typeof monthlySchema>;

export const balancesSchema = z.object({
  currency: currencySchema,
  from: isoDateSchema,
  to: isoDateSchema,
  unit: z.enum(['day', 'week', 'month']),
  accounts: z.array(
    z.object({ id: idSchema, name: z.string(), color: z.string(), type: z.string() }),
  ),
  points: z.array(
    z.object({
      date: isoDateSchema,
      total: minorUnitsSchema,
      byAccount: z.record(z.string(), minorUnitsSchema),
    }),
  ),
  excludedCurrencies: z.array(currencySchema),
});
export type BalancesDto = z.infer<typeof balancesSchema>;

export const savingsProgressSchema = z.object({
  currency: currencySchema,
  from: isoDateSchema,
  to: isoDateSchema,
  unit: z.enum(['day', 'week', 'month']),
  points: z.array(z.object({ date: isoDateSchema, total: minorUnitsSchema })),
  goals: z.array(
    z.object({
      id: idSchema,
      name: z.string(),
      color: z.string(),
      current: minorUnitsSchema,
      target: minorUnitsSchema,
      progressBp: z.number().int(),
    }),
  ),
});
export type SavingsProgressDto = z.infer<typeof savingsProgressSchema>;

export const budgetPerformanceSchema = z.object({
  currency: currencySchema,
  months: z.array(z.object({ from: isoDateSchema, to: isoDateSchema, partial: z.boolean() })),
  budgets: z.array(
    z.object({
      id: idSchema,
      name: z.string(),
      limit: minorUnitsSchema,
      /** One entry per month; null where the budget did not exist yet. */
      results: z.array(z.object({ spent: minorUnitsSchema, over: z.boolean() }).nullable()),
    }),
  ),
  /** Completed months in which every budget in force was kept. */
  monthsWithinBudget: z.number().int(),
  /** Completed months with at least one budget in force. */
  monthsEvaluated: z.number().int(),
});
export type BudgetPerformanceDto = z.infer<typeof budgetPerformanceSchema>;
