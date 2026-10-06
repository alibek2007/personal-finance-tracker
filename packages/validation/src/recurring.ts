import { z } from 'zod';
import { FREQUENCIES } from '@pfm/types';
import {
  currencySchema,
  idSchema,
  isoDateSchema,
  minorUnitsSchema,
  positiveMinorUnitsSchema,
} from './common';

export const frequencySchema = z.enum(FREQUENCIES);

const description = z
  .string()
  .trim()
  .min(1, 'Give it a name, like "Netflix"')
  .max(100, 'Use 100 characters or fewer');
const interval = z
  .number()
  .int('Use a whole number')
  .min(1, 'Use 1 or more')
  .max(60, 'Use 60 or fewer');

export const createRecurringSchema = z.object({
  /** Recurring transfers are not supported: only money in or out. */
  type: z.enum(['income', 'expense']),
  accountId: idSchema,
  categoryId: idSchema.nullish(),
  amount: positiveMinorUnitsSchema,
  description,
  frequency: frequencySchema,
  interval: interval.default(1),
  /** The date of the next payment: today or later. Later dates stay anchored to this day of the month. */
  nextOccurrence: isoDateSchema,
  endDate: isoDateSchema.nullish(),
});
export type CreateRecurringInput = z.infer<typeof createRecurringSchema>;

export const updateRecurringSchema = z
  .object({
    description,
    amount: positiveMinorUnitsSchema,
    accountId: idSchema,
    categoryId: idSchema.nullable(),
    frequency: frequencySchema,
    interval,
    nextOccurrence: isoDateSchema,
    endDate: isoDateSchema.nullable(),
    /** false pauses it; true resumes from the next payment date on or after today. */
    isActive: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Change at least one field');
export type UpdateRecurringInput = z.infer<typeof updateRecurringSchema>;

export const recurringSchema = z.object({
  id: idSchema,
  type: z.enum(['income', 'expense']),
  description: z.string(),
  amount: minorUnitsSchema,
  currency: currencySchema,
  accountId: idSchema,
  categoryId: z.string().nullable(),
  frequency: frequencySchema,
  interval: z.number().int(),
  /** "Monthly", "Every 2 weeks". */
  cadence: z.string(),
  nextOccurrence: isoDateSchema,
  endDate: isoDateSchema.nullable(),
  isActive: z.boolean(),
  /** Finished: past its end date. */
  hasEnded: z.boolean(),
  monthlyCost: minorUnitsSchema,
  yearlyCost: minorUnitsSchema,
  /** A recurring expense in the Subscriptions category. */
  isSubscription: z.boolean(),
  /** Why it cannot currently be recorded, if so. */
  blocked: z.enum(['account_archived', 'category_archived']).nullable(),
});
export type RecurringDto = z.infer<typeof recurringSchema>;

export const recurringTotalsSchema = z.object({
  currency: currencySchema,
  activeCount: z.number().int(),
  monthlyExpenses: minorUnitsSchema,
  yearlyExpenses: minorUnitsSchema,
  monthlyIncome: minorUnitsSchema,
  yearlyIncome: minorUnitsSchema,
  subscriptionsMonthly: minorUnitsSchema,
  subscriptionsYearly: minorUnitsSchema,
  subscriptionsCount: z.number().int(),
});

export const recurringListSchema = z.object({
  items: z.array(recurringSchema),
  totals: recurringTotalsSchema.nullable(),
  excludedCurrencies: z.array(currencySchema),
});
export type RecurringListDto = z.infer<typeof recurringListSchema>;

export const occurrenceQuerySchema = z
  .object({ from: isoDateSchema, to: isoDateSchema })
  .refine((q) => q.from <= q.to, {
    message: 'The start date must be before the end date',
    path: ['from'],
  })
  .refine((q) => (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 <= 400, {
    message: 'Ask for 400 days or fewer at a time',
    path: ['to'],
  });

export const occurrenceSchema = z.object({
  ruleId: idSchema,
  date: isoDateSchema,
  type: z.enum(['income', 'expense']),
  description: z.string(),
  amount: minorUnitsSchema,
  currency: currencySchema,
  accountId: idSchema,
  categoryId: z.string().nullable(),
});
export const occurrenceListSchema = z.object({ occurrences: z.array(occurrenceSchema) });
export type OccurrenceDto = z.infer<typeof occurrenceSchema>;
