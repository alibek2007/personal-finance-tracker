import { z } from 'zod';
import { CURRENCY_CODES, type CurrencyCode } from '@pfm/finance';

export const currencySchema = z.enum(CURRENCY_CODES as [CurrencyCode, ...CurrencyCode[]]);

/** Amount in integer minor units (API wire format). Always a safe integer. */
export const minorUnitsSchema = z.number().int().safe();

/** Positive amount in minor units (transactions store magnitude; direction comes from type). */
export const positiveMinorUnitsSchema = minorUnitsSchema.positive(
  'Enter an amount greater than zero',
);

export const idSchema = z.string().min(1).max(40);

/** Calendar date, no time: YYYY-MM-DD, and must be a real date (rejects 2026-02-30). */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
  .refine((value) => {
    const [y, m, d] = value.split('-').map(Number) as [number, number, number];
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  }, 'That date does not exist');

export const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #1F4E5A');

export const timezoneSchema = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, 'Unknown timezone');

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.array(z.string())).optional(),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
