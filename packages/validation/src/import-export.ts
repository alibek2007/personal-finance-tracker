import { z } from 'zod';
import { currencySchema, idSchema, isoDateSchema, minorUnitsSchema } from './common';

/** Files are read in the browser and sent as text: no multipart parsing, a hard size cap. */
export const MAX_IMPORT_CHARS = 2_000_000;
export const MAX_IMPORT_ROWS = 5000;

const column = z.number().int().min(0).max(200);

export const columnMappingSchema = z.object({
  date: column,
  description: column,
  amount: column.optional(),
  debit: column.optional(),
  credit: column.optional(),
  type: column.optional(),
  category: column.optional(),
  merchant: column.optional(),
  notes: column.optional(),
});
export type ColumnMappingInput = z.infer<typeof columnMappingSchema>;

export const importRequestSchema = z.object({
  csv: z
    .string()
    .min(1, 'Choose a file first')
    .max(MAX_IMPORT_CHARS, 'That file is too large (2 MB at most)'),
  accountId: idSchema,
  /** Omit on the first call: Ledger guesses from the headers. */
  mapping: columnMappingSchema.optional(),
  dateOrder: z.enum(['MDY', 'DMY', 'YMD']).default('MDY'),
  decimal: z.enum(['.', ',']).default('.'),
  /** Commit only: import rows that already exist anyway. */
  skipDuplicates: z.boolean().default(true),
});
export type ImportRequest = z.infer<typeof importRequestSchema>;

export const importRowSchema = z.object({
  line: z.number().int(),
  status: z.enum(['ok', 'duplicate', 'error']),
  errors: z.array(z.string()),
  date: isoDateSchema.nullable(),
  type: z.enum(['income', 'expense']).nullable(),
  amount: minorUnitsSchema.nullable(),
  description: z.string(),
  category: z.string().nullable(),
});

export const importPreviewSchema = z.object({
  headers: z.array(z.string()),
  delimiter: z.string(),
  guessedMapping: columnMappingSchema.partial(),
  /** The mapping actually applied; null while required columns are still missing. */
  mapping: columnMappingSchema.nullable(),
  currency: currencySchema,
  rowCount: z.number().int(),
  counts: z.object({ ok: z.number().int(), duplicate: z.number().int(), error: z.number().int() }),
  totals: z.object({ income: minorUnitsSchema, expense: minorUnitsSchema }),
  /** Category names in the file that match none of yours (those rows import uncategorised). */
  unmatchedCategories: z.array(z.string()),
  /** First rows, errors first, so problems are seen before the commit. */
  rows: z.array(importRowSchema),
});
export type ImportPreviewDto = z.infer<typeof importPreviewSchema>;

export const importResultSchema = z.object({
  imported: z.number().int(),
  skippedDuplicates: z.number().int(),
  skippedErrors: z.number().int(),
});
export type ImportResultDto = z.infer<typeof importResultSchema>;
