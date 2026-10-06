import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  occurrenceListSchema,
  recurringListSchema,
  recurringSchema,
  type CreateRecurringInput,
  type UpdateRecurringInput,
} from '@pfm/validation';
import { api } from './api';

const ok = z.object({ ok: z.literal(true) });

export function useRecurring() {
  return useQuery({
    queryKey: ['recurring', 'list'],
    queryFn: () => api('/recurring', recurringListSchema),
  });
}

/** Payments still to come between two dates (the dashboard's "Coming up" and, later, the calendar). */
export function useOccurrences(from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: ['recurring', 'occurrences', from, to],
    enabled,
    queryFn: () => api(`/recurring/occurrences?from=${from}&to=${to}`, occurrenceListSchema),
  });
}

/** A change to a rule can record a payment (due today), so the ledger refreshes with it. */
function useInvalidate() {
  const qc = useQueryClient();
  return () =>
    Promise.all(
      ['recurring', 'accounts', 'transactions', 'budgets', 'analytics'].map((key) =>
        qc.invalidateQueries({ queryKey: [key] }),
      ),
    );
}

export function useCreateRecurring() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: CreateRecurringInput) =>
      api('/recurring', recurringSchema, { method: 'POST', body: input }),
    onSuccess: invalidate,
  });
}

export function useUpdateRecurring(id: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: UpdateRecurringInput) =>
      api(`/recurring/${id}`, recurringSchema, { method: 'PATCH', body: input }),
    onSuccess: invalidate,
  });
}

export function useDeleteRecurring() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api(`/recurring/${id}`, ok, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}
