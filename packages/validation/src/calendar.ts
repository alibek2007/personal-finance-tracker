import { z } from 'zod';
import { currencySchema, idSchema, isoDateSchema, minorUnitsSchema } from './common';

export const calendarQuerySchema = z
  .object({ from: isoDateSchema, to: isoDateSchema })
  .refine((q) => q.from <= q.to, {
    message: 'The start date must be before the end date',
    path: ['from'],
  })
  .refine((q) => (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 <= 62, {
    message: 'Ask for 62 days or fewer at a time',
    path: ['to'],
  });

const entryBase = { description: z.string(), amount: minorUnitsSchema, currency: currencySchema };

export const calendarDaySchema = z.object({
  date: isoDateSchema,
  /** Money that actually moved on this day, in the user's main currency (other currencies are left out). */
  income: minorUnitsSchema,
  expense: minorUnitsSchema,
  transactions: z.array(
    z.object({
      id: idSchema,
      type: z.enum(['income', 'expense', 'transfer']),
      isRecurring: z.boolean(),
      ...entryBase,
    }),
  ),
  /** Payments still to come (never past dates: those are transactions). */
  upcoming: z.array(
    z.object({ ruleId: idSchema, type: z.enum(['income', 'expense']), ...entryBase }),
  ),
  goalDeadlines: z.array(
    z.object({ goalId: idSchema, name: z.string(), remaining: minorUnitsSchema }),
  ),
});

export const calendarSchema = z.object({
  from: isoDateSchema,
  to: isoDateSchema,
  today: isoDateSchema,
  currency: currencySchema,
  /** Only days with something on them. */
  days: z.array(calendarDaySchema),
});
export type CalendarDto = z.infer<typeof calendarSchema>;
export type CalendarDayDto = z.infer<typeof calendarDaySchema>;
