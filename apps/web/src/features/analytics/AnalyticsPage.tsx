import { X } from 'lucide-react';
import { Field, Input, SegmentedControl, Select } from '@pfm/ui';
import { AllCategoryOptions } from '../../components/LedgerBits';
import { NO_ACCOUNTS, NO_CATEGORIES, useAccounts, useCategories } from '../../lib/ledger';
import {
  CategoryRanking,
  IncomeVsSpending,
  NetCashFlow,
  SpendingOverTime,
  SummaryStrip,
} from './FlowCharts';
import {
  BalanceHistory,
  BudgetPerformance,
  MonthlyComparison,
  SavingsProgress,
} from './HistoryCharts';
import { RANGE_OPTIONS, useAnalyticsFilters, type RangeValue } from './filters';

const TYPES = [
  { value: '', label: 'Income and spending' },
  { value: 'income', label: 'Income only' },
  { value: 'expense', label: 'Spending only' },
] as const;

export function AnalyticsPage() {
  const f = useAnalyticsFilters();
  const accounts = useAccounts().data?.accounts ?? NO_ACCOUNTS;
  const categories = useCategories().data?.categories ?? NO_CATEGORIES;

  return (
    <div>
      <h1 className="font-display text-4xl">Analytics</h1>
      <p className="mt-1 text-muted">Questions about your money, answered with your own numbers.</p>

      <section aria-label="Filters" className="mt-6 flex flex-col gap-4 border-y border-rule py-4">
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl
            label="Date range"
            options={RANGE_OPTIONS}
            value={f.range}
            onChange={(v: RangeValue) => f.set({ range: v })}
          />
          {f.range === 'custom' ? (
            <div className="flex flex-wrap items-center gap-2">
              <Field label="From" hideLabel>
                <Input
                  type="date"
                  aria-label="From date"
                  value={f.from}
                  max={f.to || undefined}
                  onChange={(e) => f.set({ from: e.target.value || null })}
                />
              </Field>
              <span aria-hidden className="text-muted">
                to
              </span>
              <Field label="To" hideLabel>
                <Input
                  type="date"
                  aria-label="To date"
                  value={f.to}
                  min={f.from || undefined}
                  onChange={(e) => f.set({ to: e.target.value || null })}
                />
              </Field>
            </div>
          ) : null}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Account" hideLabel>
            <Select
              aria-label="Account"
              value={f.accountId}
              onChange={(e) => f.set({ account: e.target.value || null })}
            >
              <option value="">All accounts</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.isArchived ? ' (archived)' : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Category" hideLabel>
            <Select
              aria-label="Category"
              value={f.categoryId}
              onChange={(e) => f.set({ category: e.target.value || null })}
            >
              <option value="">All categories</option>
              <AllCategoryOptions categories={categories} includeArchivedId={f.categoryId} />
            </Select>
          </Field>
          <Field label="Type" hideLabel>
            <Select
              aria-label="Type"
              value={f.type}
              onChange={(e) => f.set({ type: e.target.value || null })}
            >
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {f.active ? (
          <button
            type="button"
            onClick={f.clearFilters}
            className="inline-flex items-center gap-1 self-start text-[0.8125rem] font-medium text-accent underline-offset-4 hover:underline"
          >
            <X aria-hidden className="size-3.5" /> Clear filters
          </button>
        ) : null}
      </section>

      <SummaryStrip query={f.query} ready={f.ready} />

      <div className="mt-10 grid gap-x-12 gap-y-14 xl:grid-cols-2">
        <IncomeVsSpending query={f.query} ready={f.ready} />
        <NetCashFlow query={f.query} ready={f.ready} />
        <CategoryRanking query={f.query} ready={f.ready} />
        <SpendingOverTime query={f.query} ready={f.ready} />
      </div>

      <div className="mt-14 border-t border-rule pt-10">
        <MonthlyComparison query={f.query} />
      </div>

      <div className="mt-14 grid gap-x-12 gap-y-14 border-t border-rule pt-10 xl:grid-cols-2">
        <BalanceHistory query={f.query} ready={f.ready} />
        <SavingsProgress query={f.query} ready={f.ready} />
      </div>

      <div className="mt-14 border-t border-rule pt-10">
        <BudgetPerformance />
      </div>
    </div>
  );
}
