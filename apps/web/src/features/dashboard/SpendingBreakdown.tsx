import { useMemo } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import { useNavigate } from 'react-router-dom';
import { formatMoney, money } from '@pfm/finance';
import { ChartCard } from '@pfm/ui';
import { AmountText } from '../../components/LedgerBits';
import { useCurrentUser } from '../../lib/auth';
import { useCategoryBreakdown } from '../../lib/analytics';
import { reducedMotion, sliceColor, toMajor } from './chart-utils';

const MAX_SLICES = 7;

interface Props {
  from: string;
  to: string;
  /** "October so far" */
  periodLabel: string;
}

export function SpendingBreakdown({ from, to, periodLabel }: Props) {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const query = useCategoryBreakdown({ range: 'custom', from, to });
  const data = query.data;

  // Keep the chart readable: the biggest seven categories, everything smaller rolled into one.
  const items = useMemo(() => {
    if (!data) return [];
    const head = data.slices
      .slice(0, MAX_SLICES)
      .map((s, i) => ({ ...s, color: sliceColor(i), clickable: true }));
    const tail = data.slices.slice(MAX_SLICES);
    if (tail.length === 0) return head;
    return [
      ...head,
      {
        categoryId: null as string | null,
        name: `${tail.length} other ${tail.length === 1 ? 'category' : 'categories'}`,
        color: 'var(--rule-strong)',
        amount: tail.reduce((s, t) => s + t.amount, 0),
        shareBp: tail.reduce((s, t) => s + t.shareBp, 0),
        count: tail.reduce((s, t) => s + t.count, 0),
        children: [],
        clickable: false,
      },
    ];
  }, [data]);

  const open = (categoryId: string | null) => {
    const params = new URLSearchParams({ type: 'expense', from, to });
    if (categoryId) params.set('category', categoryId);
    else params.set('uncategorized', 'true');
    navigate(`/transactions?${params.toString()}`);
  };

  const currency = data?.currency ?? user.currency;
  const pctText = (bp: number) => (bp < 100 ? '<1%' : `${Math.round(bp / 100)}%`);

  const summary = data
    ? `Donut chart of ${formatMoney(money(data.total, currency), { locale: user.locale })} spent ${periodLabel}. ${items.map((i) => `${i.name} ${pctText(i.shareBp)}`).join(', ')}.`
    : 'Spending by category';

  return (
    <ChartCard
      title="Where did my money go?"
      description={`Spending by category, ${periodLabel}`}
      loading={query.isPending}
      summary={summary}
      interactive
      empty={
        query.isError
          ? {
              title: "Couldn't load your spending",
              description: 'Check your connection and reload the page.',
            }
          : data && data.slices.length === 0
            ? {
                title: 'No spending recorded yet',
                description: 'Add a few expenses to see where your money goes.',
              }
            : undefined
      }
      dataTable={
        data ? (
          <table>
            <caption>Spending by category</caption>
            <thead>
              <tr>
                <th>Category</th>
                <th>Amount</th>
                <th>Share</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.name}>
                  <td>{i.name}</td>
                  <td>{formatMoney(money(i.amount, currency), { locale: user.locale })}</td>
                  <td>{pctText(i.shareBp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : undefined
      }
    >
      {data ? (
        <div className="grid items-center gap-6 sm:grid-cols-[11rem_minmax(0,1fr)] lg:grid-cols-1">
          <div role="img" aria-label={summary} className="relative mx-auto size-44">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart accessibilityLayer={false}>
                <Pie
                  rootTabIndex={-1}
                  data={items.map((i) => ({ name: i.name, value: toMajor(i.amount, currency) }))}
                  dataKey="value"
                  innerRadius="68%"
                  outerRadius="100%"
                  paddingAngle={items.length > 1 ? 2 : 0}
                  stroke="var(--bg)"
                  strokeWidth={2}
                  startAngle={90}
                  endAngle={-270}
                  isAnimationActive={!reducedMotion()}
                  animationDuration={400}
                >
                  {items.map((i) => (
                    <Cell key={i.name} fill={i.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="text-[0.75rem] text-muted">Spent</span>
              <span className="font-display-num text-xl font-medium">
                <AmountText minor={data.total} currency={currency} compactFraction />
              </span>
            </div>
          </div>
          <ol className="min-w-0">
            {items.map((i) => {
              const row = (
                <>
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-sm"
                    style={{ background: i.color }}
                  />
                  <span className="min-w-0 flex-1 truncate text-left">{i.name}</span>
                  <span className="num text-muted">{pctText(i.shareBp)}</span>
                  <span className="num w-20 text-right font-medium">
                    <AmountText minor={i.amount} currency={currency} compactFraction />
                  </span>
                </>
              );
              return (
                <li key={i.name} className="border-b border-rule last:border-b-0">
                  {i.clickable ? (
                    <button
                      type="button"
                      onClick={() => open(i.categoryId)}
                      aria-label={`${i.name}, ${pctText(i.shareBp)}. View these transactions`}
                      className="flex w-full items-center gap-3 py-2 text-[0.9375rem] transition-colors hover:bg-sunk/60"
                    >
                      {row}
                    </button>
                  ) : (
                    <div className="flex items-center gap-3 py-2 text-[0.9375rem]">{row}</div>
                  )}
                </li>
              );
            })}
          </ol>
          {data.excludedCurrencies.length > 0 ? (
            <p className="text-[0.8125rem] text-muted sm:col-span-2 lg:col-span-1">
              {data.excludedCurrencies.join(', ')} spending is not included: Ledger doesn't convert
              between currencies.
            </p>
          ) : null}
        </div>
      ) : (
        <span />
      )}
    </ChartCard>
  );
}
