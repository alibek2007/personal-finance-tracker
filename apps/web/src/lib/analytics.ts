import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  balancesSchema,
  budgetPerformanceSchema,
  cashFlowSchema,
  categoryBreakdownSchema,
  monthlySchema,
  overviewSchema,
  savingsProgressSchema,
  spendingTrendSchema,
  summarySchema,
  type AnalyticsQuery,
  type MonthlyQuery,
} from '@pfm/validation';
import { api } from './api';

function toQuery(query: object): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  return params.toString();
}

/** Every ledger write invalidates ['accounts'] and ['transactions']; analytics hangs off the latter. */
const key = (...parts: unknown[]) => ['transactions', 'analytics', ...parts];

export function useOverview() {
  return useQuery({
    queryKey: key('overview'),
    queryFn: () => api('/analytics/overview', overviewSchema),
  });
}

export function useCashFlow(query: Partial<AnalyticsQuery>, enabled = true) {
  return useQuery({
    queryKey: key('cash-flow', query),
    placeholderData: keepPreviousData,
    enabled,
    queryFn: () => api(`/analytics/cash-flow?${toQuery(query)}`, cashFlowSchema),
  });
}

export function useCategoryBreakdown(query: Partial<AnalyticsQuery>, enabled = true) {
  return useQuery({
    queryKey: key('categories', query),
    placeholderData: keepPreviousData,
    enabled,
    queryFn: () => api(`/analytics/categories?${toQuery(query)}`, categoryBreakdownSchema),
  });
}

export function useSummary(query: Partial<AnalyticsQuery>, enabled = true) {
  return useQuery({
    queryKey: key('summary', query),
    placeholderData: keepPreviousData,
    enabled,
    queryFn: () => api(`/analytics/summary?${toQuery(query)}`, summarySchema),
  });
}

export function useSpendingTrend(query: Partial<AnalyticsQuery>, enabled = true) {
  return useQuery({
    queryKey: key('spending-trend', query),
    placeholderData: keepPreviousData,
    enabled,
    queryFn: () => api(`/analytics/spending-trend?${toQuery(query)}`, spendingTrendSchema),
  });
}

export function useMonthly(query: Partial<MonthlyQuery>) {
  return useQuery({
    queryKey: key('monthly', query),
    placeholderData: keepPreviousData,
    queryFn: () => api(`/analytics/monthly?${toQuery(query)}`, monthlySchema),
  });
}

export function useBalances(query: Partial<AnalyticsQuery>, enabled = true) {
  return useQuery({
    queryKey: key('balances', query),
    placeholderData: keepPreviousData,
    enabled,
    queryFn: () => api(`/analytics/balances?${toQuery(query)}`, balancesSchema),
  });
}

export function useSavingsProgress(query: Partial<AnalyticsQuery>, enabled = true) {
  return useQuery({
    queryKey: key('savings', query),
    placeholderData: keepPreviousData,
    enabled,
    queryFn: () => api(`/analytics/savings?${toQuery(query)}`, savingsProgressSchema),
  });
}

export function useBudgetPerformance() {
  return useQuery({
    queryKey: [...key('budget-performance'), 'budgets'],
    queryFn: () => api('/analytics/budget-performance', budgetPerformanceSchema),
  });
}
