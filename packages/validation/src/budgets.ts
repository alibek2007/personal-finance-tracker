import { z } from 'zod';
import { BUDGET_PERIODS } from '@pfm/types';
import {
  currencySchema,
  idSchema,
  isoDateSchema,
  minorUnitsSchema,
  positiveMinorUnitsSchema,
} from './common';

export const budgetPeriodSchema = z.enum(BUDGET_PERIODS);

const alertThreshold = z
  .number()
  .int()
  .min(1, 'Choose a percentage between 1 and 100')
  .max(100, 'Choose a percentage between 1 and 100');

export const createBudgetSchema = z.object({
  /** Spending in this category, and its subcategories, counts against the budget. */
  categoryId: idSchema,
  /** Limit per period in the account currency's minor units. */
  amount: positiveMinorUnitsSchema,
  period: budgetPeriodSchema.default('monthly'),
  alertThreshold: alertThreshold.default(80),
  /** Defaults to today. The budget applies from the period containing this date. */
  startDate: isoDateSchema.optional(),
});
export type CreateBudgetInput = z.infer<typeof createBudgetSchema>;

/** The category is fixed: to budget a different one, delete this budget and create another. */
export const updateBudgetSchema = z
  .object({
    amount: positiveMinorUnitsSchema,
    period: budgetPeriodSchema,
    alertThreshold,
    endDate: isoDateSchema.nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Change at least one field');
export type UpdateBudgetInput = z.infer<typeof updateBudgetSchema>;

export const budgetSchema = z.object({
  id: idSchema,
  categoryId: idSchema,
  categoryName: z.string(),
  categoryColor: z.string(),
  /** "Food" for a subcategory budget on Coffee: gives context in lists. */
  parentCategoryName: z.string().nullable(),
  amount: minorUnitsSchema,
  currency: currencySchema,
  period: budgetPeriodSchema,
  alertThreshold: z.number().int(),
  startDate: isoDateSchema,
  endDate: isoDateSchema.nullable(),
  lifecycle: z.enum(['upcoming', 'active', 'ended']),
  periodFrom: isoDateSchema,
  periodTo: isoDateSchema,
  spent: minorUnitsSchema,
  remaining: minorUnitsSchema,
  usedBp: z.number().int(),
  elapsedBp: z.number().int(),
  daysTotal: z.number().int(),
  daysElapsed: z.number().int(),
  daysRemaining: z.number().int(),
  projectedSpent: minorUnitsSchema.nullable(),
  projectedOver: minorUnitsSchema.nullable(),
  dailyAllowance: minorUnitsSchema.nullable(),
  status: z.enum(['ok', 'warning', 'at_risk', 'over']),
  headline: z.string(),
  detail: z.string().nullable(),
});
export type BudgetDto = z.infer<typeof budgetSchema>;

export const budgetListSchema = z.object({
  budgets: z.array(budgetSchema),
  /** Totals across active monthly budgets only: mixing weekly and yearly limits would mean nothing. */
  monthly: z
    .object({
      currency: currencySchema,
      budgeted: minorUnitsSchema,
      spent: minorUnitsSchema,
      count: z.number().int(),
    })
    .nullable(),
});
export type BudgetListDto = z.infer<typeof budgetListSchema>;

export const budgetDetailSchema = budgetSchema.extend({
  /** The previous periods, most recent first. */
  history: z.array(
    z.object({
      from: isoDateSchema,
      to: isoDateSchema,
      spent: minorUnitsSchema,
      limit: minorUnitsSchema,
      overBudget: z.boolean(),
    }),
  ),
});
export type BudgetDetailDto = z.infer<typeof budgetDetailSchema>;
