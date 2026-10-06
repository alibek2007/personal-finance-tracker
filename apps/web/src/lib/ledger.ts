import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { z } from 'zod';
import {
  accountListSchema,
  accountSchema,
  categoryListSchema,
  categorySchema,
  suggestionSchema,
  transactionListSchema,
  transactionSchema,
  type AccountDto,
  type CategoryDto,
  type CreateAccountInput,
  type CreateCategoryInput,
  type CreateTransactionInput,
  type TransactionFilter,
  type TransactionListDto,
  type UpdateAccountInput,
  type UpdateCategoryInput,
  type UpdateTransactionInput,
} from '@pfm/validation';
import { api } from './api';

const ok = z.object({ ok: z.literal(true) });
const count = z.object({ count: z.number().int() });

/** Everything derived from the ledger refetches together, so balances can never disagree with lists. */
export function invalidateLedger(qc: QueryClient) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: ['accounts'] }),
    qc.invalidateQueries({ queryKey: ['transactions'] }),
    qc.invalidateQueries({ queryKey: ['budgets'] }),
  ]);
}

// ------------------------------------------------------------------ reads

export function useAccounts(includeArchived = true) {
  return useQuery({
    queryKey: ['accounts', { includeArchived }],
    queryFn: () => api(`/accounts?includeArchived=${includeArchived}`, accountListSchema),
  });
}

export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    staleTime: 5 * 60_000,
    queryFn: () => api('/categories?includeArchived=true', categoryListSchema),
  });
}

/** Stable, serialisable query string for a filter (undefined values dropped). */
export function filterToQuery(filter: Partial<TransactionFilter>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  return params.toString();
}

export function useTransactions(filter: Partial<TransactionFilter>) {
  return useQuery({
    queryKey: ['transactions', 'list', filter],
    placeholderData: keepPreviousData,
    queryFn: () => api(`/transactions?${filterToQuery(filter)}`, transactionListSchema),
  });
}

export function useTransaction(id: string | undefined) {
  return useQuery({
    queryKey: ['transactions', 'detail', id],
    enabled: Boolean(id),
    queryFn: () => api(`/transactions/${id}`, transactionSchema),
  });
}

export function useSuggestions() {
  return useQuery({
    queryKey: ['transactions', 'suggestions'],
    staleTime: 60_000,
    queryFn: () => api('/transactions/suggestions', suggestionSchema),
  });
}

// ------------------------------------------------------------------ transaction writes

export function useCreateTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTransactionInput) =>
      api('/transactions', transactionSchema, { method: 'POST', body: input }),
    onSuccess: () => invalidateLedger(qc),
  });
}

export function useUpdateTransaction(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateTransactionInput) =>
      api(`/transactions/${id}`, transactionSchema, { method: 'PATCH', body: input }),
    onSuccess: () => invalidateLedger(qc),
  });
}

type ListSnapshot = [readonly unknown[], TransactionListDto | undefined][];

function patchLists(
  qc: QueryClient,
  update: (list: TransactionListDto) => TransactionListDto,
): ListSnapshot {
  const snapshots = qc.getQueriesData<TransactionListDto>({ queryKey: ['transactions', 'list'] });
  qc.setQueriesData<TransactionListDto>({ queryKey: ['transactions', 'list'] }, (old) =>
    old ? update(old) : old,
  );
  return snapshots;
}

function restore(qc: QueryClient, snapshots: ListSnapshot | undefined) {
  for (const [key, data] of snapshots ?? []) qc.setQueryData(key, data);
}

/** Removes the row from every cached list instantly, rolls back if the server refuses. */
export function useDeleteTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/transactions/${id}`, ok, { method: 'DELETE' }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['transactions', 'list'] });
      return {
        snapshots: patchLists(qc, (list) => ({
          ...list,
          items: list.items.filter((t) => t.id !== id),
          total: Math.max(0, list.total - 1),
        })),
      };
    },
    onError: (_error, _id, context) => restore(qc, context?.snapshots),
    onSettled: () => invalidateLedger(qc),
  });
}

export function useBulkDelete() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) =>
      api('/transactions/bulk-delete', count, { method: 'POST', body: { ids } }),
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: ['transactions', 'list'] });
      const gone = new Set(ids);
      return {
        snapshots: patchLists(qc, (list) => {
          const items = list.items.filter((t) => !gone.has(t.id));
          return {
            ...list,
            items,
            total: Math.max(0, list.total - (list.items.length - items.length)),
          };
        }),
      };
    },
    onError: (_error, _ids, context) => restore(qc, context?.snapshots),
    onSettled: () => invalidateLedger(qc),
  });
}

export function useBulkCategorize() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { ids: string[]; categoryId: string | null }) =>
      api('/transactions/bulk-categorize', count, { method: 'POST', body: input }),
    onMutate: async ({ ids, categoryId }) => {
      await qc.cancelQueries({ queryKey: ['transactions', 'list'] });
      const chosen = new Set(ids);
      return {
        snapshots: patchLists(qc, (list) => ({
          ...list,
          items: list.items.map((t) =>
            chosen.has(t.id) && t.type !== 'transfer' ? { ...t, categoryId } : t,
          ),
        })),
      };
    },
    onError: (_error, _input, context) => restore(qc, context?.snapshots),
    onSettled: () => invalidateLedger(qc),
  });
}

// ------------------------------------------------------------------ accounts + categories writes

export function useCreateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAccountInput) =>
      api('/accounts', accountSchema, { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  });
}

export function useUpdateAccount(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateAccountInput) =>
      api(`/accounts/${id}`, accountSchema, { method: 'PATCH', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  });
}

export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/accounts/${id}`, ok, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  });
}

export function useCreateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCategoryInput) =>
      api('/categories', categorySchema, { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
  });
}

export function useUpdateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateCategoryInput & { id: string }) =>
      api(`/categories/${id}`, categorySchema, { method: 'PATCH', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
  });
}

/** `reassignTo` moves existing transactions to another category before deleting. */
export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reassignTo }: { id: string; reassignTo?: string }) =>
      api(`/categories/${id}${reassignTo ? `?reassignTo=${reassignTo}` : ''}`, ok, {
        method: 'DELETE',
      }),
    onSuccess: () =>
      invalidateLedger(qc).then(() => qc.invalidateQueries({ queryKey: ['categories'] })),
  });
}

// ------------------------------------------------------------------ lookup helpers

export interface CategoryIndex {
  byId: Map<string, CategoryDto>;
  /** "Food › Coffee" for subcategories, "Food" for top-level. */
  label: (id: string | null | undefined) => string;
}

export function buildCategoryIndex(categories: CategoryDto[] | undefined): CategoryIndex {
  const byId = new Map((categories ?? []).map((c) => [c.id, c]));
  return {
    byId,
    label(id) {
      if (!id) return 'Uncategorised';
      const c = byId.get(id);
      if (!c) return 'Uncategorised';
      const parent = c.parentId ? byId.get(c.parentId) : undefined;
      return parent ? `${parent.name} › ${c.name}` : c.name;
    },
  };
}

export function buildAccountIndex(accounts: AccountDto[] | undefined) {
  return new Map((accounts ?? []).map((a) => [a.id, a]));
}

/** Stable empty arrays so `data ?? EMPTY` never changes identity between renders. */
export const NO_ACCOUNTS: AccountDto[] = [];
export const NO_CATEGORIES: CategoryDto[] = [];
