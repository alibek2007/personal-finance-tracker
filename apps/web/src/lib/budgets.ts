import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  budgetListSchema,
  budgetSchema,
  type CreateBudgetInput,
  type UpdateBudgetInput,
} from '@pfm/validation';
import { api } from './api';

const ok = z.object({ ok: z.literal(true) });

export function useBudgets() {
  return useQuery({
    queryKey: ['budgets'],
    queryFn: () => api('/budgets', budgetListSchema),
  });
}

export function useCreateBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateBudgetInput) =>
      api('/budgets', budgetSchema, { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budgets'] }),
  });
}

export function useUpdateBudget(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateBudgetInput) =>
      api(`/budgets/${id}`, budgetSchema, { method: 'PATCH', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budgets'] }),
  });
}

export function useDeleteBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/budgets/${id}`, ok, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budgets'] }),
  });
}
