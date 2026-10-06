import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { money, toDecimalString, type CurrencyCode } from '@pfm/finance';
import { searchResultSchema } from '@pfm/validation';
import { api } from './api';

/** Waits for a pause in typing, so one request is made per thought rather than per keystroke. */
export function useDebounced<T>(value: T, ms = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

export function useSearch(query: string, enabled: boolean) {
  const q = query.trim();
  return useQuery({
    queryKey: ['search', q],
    enabled: enabled && q.length >= 2,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    queryFn: () => api(`/search?q=${encodeURIComponent(q)}`, searchResultSchema),
  });
}

/** The server's interpreted filter, as the Transactions screen's URL (which uses friendlier names). */
export function transactionsUrl(filter: Record<string, string>, currency: CurrencyCode): string {
  const params = new URLSearchParams();
  const rename: Record<string, string> = {
    q: 'q',
    type: 'type',
    categoryId: 'category',
    dateFrom: 'from',
    dateTo: 'to',
  };
  for (const [key, value] of Object.entries(filter)) {
    if (rename[key]) params.set(rename[key], value);
    else if (key === 'amountMin' || key === 'amountMax') {
      params.set(
        key === 'amountMin' ? 'min' : 'max',
        toDecimalString(money(Number(value), currency)),
      );
    }
  }
  const qs = params.toString();
  return qs ? `/transactions?${qs}` : '/transactions';
}
