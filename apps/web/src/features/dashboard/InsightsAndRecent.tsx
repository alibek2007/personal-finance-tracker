import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Button, EmptyState, Skeleton, cn } from '@pfm/ui';
import type { OverviewDto } from '@pfm/validation';
import {
  AmountText,
  CategoryDot,
  TransferGlyph,
  useFormatDay,
  transactionTitle,
} from '../../components/LedgerBits';
import {
  buildAccountIndex,
  buildCategoryIndex,
  NO_ACCOUNTS,
  NO_CATEGORIES,
  useAccounts,
  useCategories,
  useTransactions,
} from '../../lib/ledger';

const MARK = { positive: '✓', negative: '▲', neutral: '•' } as const;
const LABEL = { positive: 'Good news', negative: 'Worth watching', neutral: 'Note' } as const;

export function Insights({ overview }: { overview: OverviewDto }) {
  const { insights } = overview;
  const monthParams = (categoryId?: string | null) => {
    const p = new URLSearchParams({
      type: 'expense',
      from: overview.month.from,
      to: overview.month.to,
    });
    if (categoryId) p.set('category', categoryId);
    return p.toString();
  };
  return (
    <section aria-labelledby="insights-title">
      <h2 id="insights-title" className="font-display text-xl">
        What stands out
      </h2>
      {insights.length === 0 ? (
        <p className="mt-3 max-w-prose text-muted">
          {overview.hasTransactions
            ? 'Nothing unusual yet. Insights appear once there are a few days of activity to compare with last month.'
            : 'Add a few transactions to unlock your spending insights.'}
        </p>
      ) : (
        <ul className="mt-3">
          {insights.map((insight) => (
            <li key={insight.id} className="flex gap-3 border-t border-rule py-3 first:border-t-0">
              <span
                aria-hidden
                className={cn(
                  'mt-0.5 w-4 shrink-0 text-center text-[0.8125rem]',
                  insight.tone === 'positive' && 'text-gain',
                  insight.tone === 'negative' && 'text-loss',
                  insight.tone === 'neutral' && 'text-muted',
                )}
              >
                {MARK[insight.tone]}
              </span>
              <p className="min-w-0 flex-1">
                <span className="sr-only">{LABEL[insight.tone]}: </span>
                {insight.text}{' '}
                {insight.categoryId ? (
                  <Link
                    to={`/transactions?${monthParams(insight.categoryId)}`}
                    className="whitespace-nowrap text-[0.8125rem] font-medium text-accent hover:underline"
                  >
                    See transactions
                  </Link>
                ) : null}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function RecentTransactions() {
  const formatDay = useFormatDay();
  const list = useTransactions({ sort: 'date', dir: 'desc', page: 1, pageSize: 8 });
  const accountsQuery = useAccounts();
  const categoriesQuery = useCategories();
  const accounts = accountsQuery.data?.accounts ?? NO_ACCOUNTS;
  const categories = categoriesQuery.data?.categories ?? NO_CATEGORIES;
  const accountIndex = useMemo(() => buildAccountIndex(accounts), [accounts]);
  const categoryIndex = useMemo(() => buildCategoryIndex(categories), [categories]);

  return (
    <section aria-labelledby="recent-title">
      <div className="flex items-baseline justify-between">
        <h2 id="recent-title" className="font-display text-xl">
          Recent transactions
        </h2>
        <Link
          to="/transactions"
          className="text-[0.875rem] font-medium text-accent hover:underline"
        >
          View all transactions
        </Link>
      </div>
      {list.isPending ? (
        <div className="mt-3 space-y-3" role="status" aria-label="Loading recent transactions">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : list.isError ? (
        <EmptyState
          title="Couldn't load recent transactions"
          description="Check your connection and try again."
          action={<Button onClick={() => void list.refetch()}>Try again</Button>}
        />
      ) : list.data.items.length === 0 ? (
        <p className="mt-3 text-muted">No transactions yet.</p>
      ) : (
        <ul className="mt-2">
          {list.data.items.map((t) => {
            const cat = t.categoryId ? categoryIndex.byId.get(t.categoryId) : undefined;
            return (
              <li
                key={t.id}
                className="flex items-center gap-3 border-t border-rule py-2.5 first:border-t-0"
              >
                <CategoryDot
                  color={
                    t.type === 'transfer'
                      ? 'var(--rule-strong)'
                      : (cat?.color ?? 'var(--rule-strong)')
                  }
                />
                <Link to={`/transactions/${t.id}/edit`} className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {t.type === 'transfer'
                      ? transactionTitle(t, accountIndex)
                      : t.merchant || t.description}
                  </span>
                  <span className="block truncate text-[0.8125rem] text-muted">
                    {formatDay(t.date)} ·{' '}
                    {t.type === 'transfer' ? 'Transfer' : categoryIndex.label(t.categoryId)}
                  </span>
                </Link>
                <span className="inline-flex items-center gap-1 font-medium">
                  {t.type === 'transfer' ? <TransferGlyph /> : null}
                  <AmountText
                    minor={t.amount}
                    currency={t.currency}
                    kind={
                      t.type === 'income' ? 'income' : t.type === 'expense' ? 'expense' : 'transfer'
                    }
                  />
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
