import { z } from 'zod';
import { currencySchema, idSchema, minorUnitsSchema } from './common';
import { transactionSchema } from './transactions';

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1, 'Type something to search for').max(100),
});

export const searchResultSchema = z.object({
  query: z.string(),
  /** What the interpreter understood ("expenses", "over $50", "last month"); empty for plain text. */
  understood: z.array(z.string()),
  /** The transaction filter the interpretation turned into, so "see all" opens the same results. */
  transactionFilter: z.record(z.string(), z.string()),
  transactions: z.object({
    total: z.number().int(),
    items: z.array(transactionSchema.extend({ categoryName: z.string().nullable() })),
  }),
  accounts: z.array(
    z.object({
      id: idSchema,
      name: z.string(),
      currency: currencySchema,
      balance: minorUnitsSchema,
      isArchived: z.boolean(),
    }),
  ),
  categories: z.array(
    z.object({ id: idSchema, name: z.string(), parentName: z.string().nullable() }),
  ),
  goals: z.array(z.object({ id: idSchema, name: z.string() })),
  recurring: z.array(
    z.object({
      id: idSchema,
      description: z.string(),
      amount: minorUnitsSchema,
      currency: currencySchema,
    }),
  ),
});
export type SearchResultDto = z.infer<typeof searchResultSchema>;
