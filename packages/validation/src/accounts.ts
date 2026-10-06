import { z } from 'zod';
import { ACCOUNT_TYPES } from '@pfm/types';
import { currencySchema, hexColorSchema, idSchema, minorUnitsSchema } from './common';

export const accountTypeSchema = z.enum(ACCOUNT_TYPES);

const accountName = z
  .string()
  .trim()
  .min(1, 'Give the account a name')
  .max(60, 'Use 60 characters or fewer');

export const createAccountSchema = z.object({
  name: accountName,
  type: accountTypeSchema,
  institution: z.string().trim().max(80).nullish(),
  currency: currencySchema,
  /** Balance when you started tracking it. Negative for money owed (credit cards). */
  initialBalance: minorUnitsSchema.default(0),
  color: hexColorSchema.default('#1f4e5a'),
  icon: z.string().min(1).max(40).default('wallet'),
});
export type CreateAccountInput = z.infer<typeof createAccountSchema>;

/** Currency is fixed once an account exists: its history is denominated in it. */
export const updateAccountSchema = z
  .object({
    name: accountName,
    type: accountTypeSchema,
    institution: z.string().trim().max(80).nullable(),
    initialBalance: minorUnitsSchema,
    color: hexColorSchema,
    icon: z.string().min(1).max(40),
    isArchived: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Change at least one field');
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;

export const accountSchema = z.object({
  id: idSchema,
  name: z.string(),
  type: accountTypeSchema,
  institution: z.string().nullable(),
  currency: currencySchema,
  initialBalance: minorUnitsSchema,
  currentBalance: minorUnitsSchema,
  color: z.string(),
  icon: z.string(),
  isArchived: z.boolean(),
});
export type AccountDto = z.infer<typeof accountSchema>;

export const currencyTotalsSchema = z.object({
  currency: currencySchema,
  assets: minorUnitsSchema,
  debts: minorUnitsSchema,
  netWorth: minorUnitsSchema,
});

export const accountListSchema = z.object({
  accounts: z.array(accountSchema),
  totals: z.array(currencyTotalsSchema),
});
export type AccountListDto = z.infer<typeof accountListSchema>;

export const balanceHistorySchema = z.object({
  points: z.array(z.object({ date: z.string(), balance: minorUnitsSchema })),
});
