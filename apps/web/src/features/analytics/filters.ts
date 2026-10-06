import { useSearchParams } from 'react-router-dom';
import type { AnalyticsQuery } from '@pfm/validation';

export const RANGE_OPTIONS = [
  { value: '7d', label: '7D', ariaLabel: 'Last 7 days' },
  { value: '30d', label: '30D', ariaLabel: 'Last 30 days' },
  { value: '3m', label: '3M', ariaLabel: 'Last 3 months' },
  { value: '6m', label: '6M', ariaLabel: 'Last 6 months' },
  { value: '1y', label: '1Y', ariaLabel: 'Last year' },
  { value: 'custom', label: 'Custom', ariaLabel: 'Custom date range' },
] as const;
export type RangeValue = (typeof RANGE_OPTIONS)[number]['value'];

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isRange = (v: string | null): v is RangeValue => RANGE_OPTIONS.some((o) => o.value === v);

/**
 * The filters live in the URL so a view can be shared or bookmarked and the back button works.
 * `ready` is false for a custom range until both dates are chosen (and in order).
 */
export function useAnalyticsFilters() {
  const [params, setParams] = useSearchParams();
  const range: RangeValue = isRange(params.get('range'))
    ? (params.get('range') as RangeValue)
    : '30d';
  const from = params.get('from');
  const to = params.get('to');
  const validFrom = from && ISO.test(from) ? from : undefined;
  const validTo = to && ISO.test(to) ? to : undefined;
  const type = params.get('type');

  const query: Partial<AnalyticsQuery> = {
    range,
    ...(range === 'custom' && validFrom ? { from: validFrom } : {}),
    ...(range === 'custom' && validTo ? { to: validTo } : {}),
    ...(params.get('account') ? { accountId: params.get('account')! } : {}),
    ...(params.get('category') ? { categoryId: params.get('category')! } : {}),
    ...(type === 'income' || type === 'expense' ? { type } : {}),
  };
  const ready = range !== 'custom' || Boolean(validFrom && validTo && validFrom <= validTo);

  function set(changes: Record<string, string | null>) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(changes)) {
          if (v === null || v === '') next.delete(k);
          else next.set(k, v);
        }
        return next;
      },
      { replace: true },
    );
  }

  const active = ['account', 'category', 'type'].some((k) => params.has(k));
  return {
    range,
    from: validFrom ?? '',
    to: validTo ?? '',
    accountId: params.get('account') ?? '',
    categoryId: params.get('category') ?? '',
    type: type === 'income' || type === 'expense' ? type : '',
    query,
    ready,
    active,
    set,
    clearFilters: () => set({ account: null, category: null, type: null }),
  };
}
