import { z } from 'zod';
import {
  currencySchema,
  hexColorSchema,
  idSchema,
  isoDateSchema,
  minorUnitsSchema,
  positiveMinorUnitsSchema,
} from './common';

const goalName = z
  .string()
  .trim()
  .min(1, 'Give your goal a name')
  .max(60, 'Use 60 characters or fewer');

export const createGoalSchema = z.object({
  name: goalName,
  targetAmount: positiveMinorUnitsSchema,
  /** Optional. Without one, Ledger can show progress but not a monthly amount. */
  deadline: isoDateSchema.nullish(),
  /** Already put aside before you started tracking. Recorded as the first contribution. */
  startingAmount: minorUnitsSchema.min(0).optional(),
  color: hexColorSchema.default('#1f4e5a'),
  icon: z.string().min(1).max(40).default('target'),
});
export type CreateGoalInput = z.infer<typeof createGoalSchema>;

export const updateGoalSchema = z
  .object({
    name: goalName,
    targetAmount: positiveMinorUnitsSchema,
    deadline: isoDateSchema.nullable(),
    color: hexColorSchema,
    isArchived: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Change at least one field');
export type UpdateGoalInput = z.infer<typeof updateGoalSchema>;

/** Positive = you put money aside; negative = you took some back out. */
export const contributionSchema = z.object({
  amount: minorUnitsSchema.refine((n) => n !== 0, 'Enter an amount other than zero'),
  date: isoDateSchema.optional(),
  note: z.string().trim().max(200).nullish(),
});
export type ContributionInput = z.infer<typeof contributionSchema>;

export const contributionDtoSchema = z.object({
  id: idSchema,
  amount: minorUnitsSchema,
  date: isoDateSchema,
  note: z.string().nullable(),
  createdAt: z.string(),
});

export const goalSchema = z.object({
  id: idSchema,
  name: z.string(),
  targetAmount: minorUnitsSchema,
  currentAmount: minorUnitsSchema,
  currency: currencySchema,
  deadline: isoDateSchema.nullable(),
  color: z.string(),
  icon: z.string(),
  isArchived: z.boolean(),
  startedOn: isoDateSchema,
  progressBp: z.number().int(),
  remaining: minorUnitsSchema,
  surplus: minorUnitsSchema,
  reached: z.boolean(),
  daysLeft: z.number().int().nullable(),
  monthsLeft: z.number().int().nullable(),
  requiredMonthly: minorUnitsSchema.nullable(),
  expectedAmount: minorUnitsSchema.nullable(),
  scheduleDelta: minorUnitsSchema.nullable(),
  status: z.enum(['reached', 'overdue', 'no_deadline', 'ahead', 'on_track', 'behind']),
  headline: z.string(),
  detail: z.string().nullable(),
});
export type GoalDto = z.infer<typeof goalSchema>;

export const goalListSchema = z.object({
  goals: z.array(goalSchema),
  /** Totals across active (not archived) goals. */
  summary: z
    .object({
      currency: currencySchema,
      saved: minorUnitsSchema,
      target: minorUnitsSchema,
      count: z.number().int(),
    })
    .nullable(),
});
export type GoalListDto = z.infer<typeof goalListSchema>;

export const goalDetailSchema = goalSchema.extend({
  /** Most recent first. */
  contributions: z.array(contributionDtoSchema),
});
export type GoalDetailDto = z.infer<typeof goalDetailSchema>;
