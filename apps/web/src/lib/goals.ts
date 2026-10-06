import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  goalDetailSchema,
  goalListSchema,
  goalSchema,
  type ContributionInput,
  type CreateGoalInput,
  type UpdateGoalInput,
} from '@pfm/validation';
import { api } from './api';

const ok = z.object({ ok: z.literal(true) });

export function useGoals(includeArchived = true) {
  return useQuery({
    queryKey: ['goals', 'list', { includeArchived }],
    queryFn: () => api(`/goals?includeArchived=${includeArchived}`, goalListSchema),
  });
}

export function useGoal(id: string | null) {
  return useQuery({
    queryKey: ['goals', 'detail', id],
    enabled: id !== null,
    queryFn: () => api(`/goals/${id}`, goalDetailSchema),
  });
}

/** Any goal change refreshes both the list and the open detail. */
function useInvalidateGoals() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['goals'] });
}

export function useCreateGoal() {
  const invalidate = useInvalidateGoals();
  return useMutation({
    mutationFn: (input: CreateGoalInput) =>
      api('/goals', goalSchema, { method: 'POST', body: input }),
    onSuccess: invalidate,
  });
}

export function useUpdateGoal(id: string) {
  const invalidate = useInvalidateGoals();
  return useMutation({
    mutationFn: (input: UpdateGoalInput) =>
      api(`/goals/${id}`, goalSchema, { method: 'PATCH', body: input }),
    onSuccess: invalidate,
  });
}

export function useDeleteGoal() {
  const invalidate = useInvalidateGoals();
  return useMutation({
    mutationFn: (id: string) => api(`/goals/${id}`, ok, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

export function useAddContribution(id: string) {
  const invalidate = useInvalidateGoals();
  return useMutation({
    mutationFn: (input: ContributionInput) =>
      api(`/goals/${id}/contributions`, goalSchema, { method: 'POST', body: input }),
    onSuccess: invalidate,
  });
}

export function useRemoveContribution(id: string) {
  const invalidate = useInvalidateGoals();
  return useMutation({
    mutationFn: (contributionId: string) =>
      api(`/goals/${id}/contributions/${contributionId}`, goalSchema, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}
