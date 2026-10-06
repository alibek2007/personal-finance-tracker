import { z } from 'zod';
import { TRANSACTION_TYPES } from '@pfm/types';
import {
  currencySchema,
  idSchema,
  isoDateSchema,
  minorUnitsSchema,
  positiveMinorUnitsSchema,
} from './common';

export const transactionTypeSchema = z.enum(TRANSACTION_TYPES);

const description = z
  .string()
  .trim()
  .min(1, 'Add a short description')
  .max(200, 'Use 200 characters or fewer');

const baseTransaction = z.object({
  type: transactionTypeSchema,
  accountId: idSchema,
  categoryId: idSchema.nullish(),
  /** Positive magnitude in the account's minor units; direction comes from `type`. */
  amount: positiveMinorUnitsSchema,
  description,
  merchant: z.string().trim().max(80).nullish(),
  date: isoDateSchema,
  notes: z.string().trim().max(1000).nullish(),
  /** Transfers only. */
  transferAccountId: idSchema.nullish(),
  transferAmount: positiveMinorUnitsSchema.nullish(),
  /** Income that returns money from an expense (credited back to that expense's category). */
  isRefund: z.boolean().default(false),
});

export const createTransactionSchema = baseTransaction;
export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;

export const updateTransactionSchema = baseTransaction
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Change at least one field');
export type UpdateTransactionInput = z.infer<typeof updateTransactionSchema>;

export const transactionSchema = z.object({
  id: idSchema,
  type: transactionTypeSchema,
  accountId: idSchema,
  categoryId: z.string().nullable(),
  amount: minorUnitsSchema,
  currency: currencySchema,
  transferAccountId: z.string().nullable(),
  transferAmount: minorUnitsSchema.nullable(),
  isRefund: z.boolean(),
  description: z.string(),
  merchant: z.string().nullable(),
  date: isoDateSchema,
  notes: z.string().nullable(),
  isRecurring: z.boolean(),
  createdAt: z.string(),
});
export type TransactionDto = z.infer<typeof transactionSchema>;

/** Query-string filters. Everything optional; numbers arrive as strings and are coerced. */
export const transactionFilterSchema = z
  .object({
    q: z.string().trim().max(100).optional(),
    type: transactionTypeSchema.optional(),
    accountId: idSchema.optional(),
    /** Includes the category's subcategories. */
    categoryId: idSchema.optional(),
    uncategorized: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
    dateFrom: isoDateSchema.optional(),
    dateTo: isoDateSchema.optional(),
    /** Absolute amount bounds in minor units. */
    amountMin: z.coerce.number().int().min(0).optional(),
    amountMax: z.coerce.number().int().min(0).optional(),
    sort: z.enum(['date', 'amount']).default('date'),
    dir: z.enum(['asc', 'desc']).default('desc'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .refine((f) => !f.dateFrom || !f.dateTo || f.dateFrom <= f.dateTo, {
    message: 'The start date must be before the end date',
    path: ['dateFrom'],
  })
  .refine(
    (f) => f.amountMin === undefined || f.amountMax === undefined || f.amountMin <= f.amountMax,
    {
      message: 'The minimum amount must be below the maximum',
      path: ['amountMin'],
    },
  );
export type TransactionFilter = z.infer<typeof transactionFilterSchema>;

export const transactionListSchema = z.object({
  items: z.array(transactionSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type TransactionListDto = z.infer<typeof transactionListSchema>;

export const bulkCategorizeSchema = z.object({
  ids: z.array(idSchema).min(1).max(200),
  categoryId: idSchema.nullable(),
});
export type BulkCategorizeInput = z.infer<typeof bulkCategorizeSchema>;

export const bulkDeleteSchema = z.object({ ids: z.array(idSchema).min(1).max(200) });

/** Frequently used account+category combinations, to make repeat entry one tap. */
export const suggestionSchema = z.object({
  suggestions: z.array(
    z.object({
      type: transactionTypeSchema,
      accountId: idSchema,
      categoryId: z.string().nullable(),
      description: z.string(),
      merchant: z.string().nullable(),
      count: z.number().int(),
    }),
  ),
});
export type SuggestionsDto = z.infer<typeof suggestionSchema>;
