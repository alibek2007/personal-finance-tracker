import { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent';
import { currencyExponent, type CurrencyCode } from '@pfm/finance';
import { Badge, ChartCard, ProgressBar, cn } from '@pfm/ui';
import type { AnalyticsQuery } from '@pfm/validation';
import { AmountText } from '../../components/LedgerBits';
import { useCurrentUser } from '../../lib/auth';
import {
  useBalances,
  useBudgetPerformance,
  useMonthly,
  useSavingsProgress,
} from '../../lib/analytics';
import { compactMoney, niceY, reducedMotion, sliceColor, toMajor } from '../dashboard/chart-utils';
import { CHART_AXIS, ChangeText, Legend, ScopeNote, TooltipBox, useMoneyFormat } from './chart-kit';

type Q = Partial<AnalyticsQuery>;
const errorEmpty = {
  title: "Couldn't load this chart",
  description: 'Check your connection and reload the page.',
};
const HEIGHT = 'h-64 w-full';

function yTick(currency: CurrencyCode, locale: string) {
  return (v: number) =>
    compactMoney(Math.round(v * 10 ** currencyExponent(currency)), currency, locale);
}
const dateLabel = (iso: string) => format(parseISO(iso), 'MMM d');

// ------------------------------------------------------------------ month by month

export function MonthlyComparison({ query }: { query: Q }) {
  const user = useCurrentUser();
  const fmt = useMoneyFormat();
  const monthly = useMonthly({
    months: 12,
    ...(query.accountId ? { accountId: query.accountId } : {}),
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    ...(query.type ? { type: query.type } : {}),
  });
  const data = monthly.data;
  // History often starts part-way through the year; do not draw months before the first activity.
  const months = useMemo(() => {
    const all = data?.months ?? [];
    const first = all.findIndex((m) => m.income !== 0 || m.spent !== 0);
    const start = first < 0 ? 0 : Math.min(first, Math.max(0, all.length - 3));
    return all.slice(start);
  }, [data]);
  const rows = useMemo(
    () =>
      months.map((m) => ({
        ...m,
        label: format(parseISO(m.from), 'MMM'),
        income$: toMajor(m.income, data?.currency ?? 'USD'),
        spent$: toMajor(m.spent, data?.currency ?? 'USD'),
      })),
    [months, data?.currency],
  );
  const empty = data && data.months.every((m) => m.income === 0 && m.spent === 0);
  return (
    <ChartCard
      title="How does this month compare?"
      description="Income and spending, month by month"
      loading={monthly.isPending}
      summary={
        data
          ? `Bar chart of income and spending for the last ${months.length} months with activity.`
          : 'Monthly comparison'
      }
      empty={
        monthly.isError
          ? errorEmpty
          : empty
            ? {
                title: 'No history yet',
                description:
                  'Monthly comparisons appear once you have a couple of months of transactions.',
              }
            : undefined
      }
    >
      {data ? (
        <>
          <Legend
            items={[
              { label: 'Income', color: 'var(--gain)' },
              { label: 'Spent', color: 'var(--loss)' },
            ]}
          />
          <div className={HEIGHT}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                accessibilityLayer={false}
                data={rows}
                barGap={2}
                margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
              >
                <CartesianGrid vertical={false} stroke="var(--rule)" />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={{ stroke: 'var(--rule-strong)' }}
                  tick={CHART_AXIS}
                />
                <YAxis
                  {...niceY()}
                  width={52}
                  tickLine={false}
                  axisLine={false}
                  tick={CHART_AXIS}
                  tickFormatter={yTick(data.currency, user.locale)}
                />
                <Tooltip
                  cursor={{ fill: 'var(--sunk)' }}
                  content={(p: TooltipContentProps<ValueType, NameType>) =>
                    p.active && p.payload?.length ? (
                      <TooltipBox
                        title={`${format(parseISO((p.payload[0]!.payload as { from: string }).from), 'MMMM yyyy')}${(p.payload[0]!.payload as { partial: boolean }).partial ? ' (so far)' : ''}`}
                        rows={[
                          {
                            label: 'Income',
                            value: fmt.full(
                              (p.payload[0]!.payload as { income: number }).income,
                              data.currency,
                              true,
                            ),
                          },
                          {
                            label: 'Spent',
                            value: fmt.full(
                              -(p.payload[0]!.payload as { spent: number }).spent,
                              data.currency,
                            ),
                          },
                        ]}
                      />
                    ) : null
                  }
                />
                <Bar
                  dataKey="income$"
                  name="Income"
                  fill="var(--gain)"
                  radius={[2, 2, 0, 0]}
                  isAnimationActive={!reducedMotion()}
                  animationDuration={400}
                />
                <Bar
                  dataKey="spent$"
                  name="Spent"
                  fill="var(--loss)"
                  radius={[2, 2, 0, 0]}
                  isAnimationActive={!reducedMotion()}
                  animationDuration={400}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div
            className="relative mt-4 overflow-x-auto"
            role="region"
            aria-label="Month by month table, scrolls sideways"
            // Keyboard users need to be able to scroll a scrollable area.
            tabIndex={0}
          >
            <table className="w-full text-[0.8125rem]">
              <caption className="sr-only">Month by month</caption>
              <thead>
                <tr className="border-b border-rule text-left text-muted">
                  <th scope="col" className="py-1.5 pr-3 font-medium">
                    Month
                  </th>
                  <th
                    scope="col"
                    className="hidden py-1.5 pr-3 text-right font-medium sm:table-cell"
                  >
                    Income
                  </th>
                  <th scope="col" className="py-1.5 pr-3 text-right font-medium">
                    Spent
                  </th>
                  <th scope="col" className="py-1.5 pr-3 text-right font-medium">
                    Net
                  </th>
                  <th scope="col" className="py-1.5 font-medium">
                    Spending vs the month before
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...months].reverse().map((m) => (
                  <tr key={m.month} className="border-b border-rule last:border-b-0">
                    <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                      {format(parseISO(m.from), 'MMM yyyy')}
                      {m.partial ? <span className="ml-1.5 text-muted">so far</span> : null}
                    </th>
                    <td className="hidden py-1.5 pr-3 text-right sm:table-cell">
                      <AmountText
                        minor={m.income}
                        currency={data.currency}
                        compactFraction
                        tone={false}
                      />
                    </td>
                    <td className="py-1.5 pr-3 text-right">
                      <AmountText
                        minor={m.spent}
                        currency={data.currency}
                        compactFraction
                        tone={false}
                      />
                    </td>
                    <td className="py-1.5 pr-3 text-right">
                      <AmountText
                        minor={m.saved}
                        currency={data.currency}
                        kind="delta"
                        compactFraction
                      />
                    </td>
                    <td className="py-1.5">
                      <ChangeText
                        bp={m.spentChangeBp}
                        good="down"
                        versus={m.partial ? 'the same days last month' : 'the month before'}
                        short={!m.partial}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ScopeNote>
            Up to the last 12 months of activity; the date range above doesn't apply here.
          </ScopeNote>
        </>
      ) : (
        <span />
      )}
    </ChartCard>
  );
}

// ------------------------------------------------------------------ balances over time

export function BalanceHistory({ query, ready }: { query: Q; ready: boolean }) {
  const user = useCurrentUser();
  const fmt = useMoneyFormat();
  const { categoryId: _c, type: _t, ...rest } = query;
  const balances = useBalances(rest, ready);
  const [showAccounts, setShowAccounts] = useState(false);
  const data = balances.data;
  const rows = useMemo(
    () =>
      data
        ? data.points.map((p) => ({
            date: p.date,
            label: dateLabel(p.date),
            total$: toMajor(p.total, data.currency),
            ...Object.fromEntries(
              data.accounts.map((a) => [a.id, toMajor(p.byAccount[a.id] ?? 0, data.currency)]),
            ),
          }))
        : [],
    [data],
  );
  const first = data?.points[0]?.total ?? 0;
  const last = data?.points.at(-1)?.total ?? 0;
  const single = (data?.accounts.length ?? 0) <= 1;
  return (
    <ChartCard
      title="Is my net worth growing?"
      description={
        query.accountId
          ? 'Balance of the chosen account'
          : 'All accounts together, debts subtracted'
      }
      loading={ready ? balances.isPending : false}
      summary={
        data
          ? `Line chart of net worth from ${fmt.full(first, data.currency)} to ${fmt.full(last, data.currency)}, a change of ${fmt.full(last - first, data.currency, true)}.`
          : 'Balance history'
      }
      empty={
        balances.isError
          ? errorEmpty
          : !ready || (data && data.accounts.length === 0)
            ? {
                title: 'No accounts to show',
                description: 'Add an account in your main currency to see its balance over time.',
              }
            : undefined
      }
      actions={
        !single ? (
          <button
            type="button"
            className="text-[0.8125rem] font-medium text-accent underline-offset-4 hover:underline"
            aria-pressed={showAccounts}
            onClick={() => setShowAccounts((s) => !s)}
          >
            {showAccounts ? 'Hide individual accounts' : 'Show each account'}
          </button>
        ) : undefined
      }
      dataTable={
        data ? (
          <table>
            <caption>Balances over time</caption>
            <thead>
              <tr>
                <th>Date</th>
                <th>Net worth</th>
                {data.accounts.map((a) => (
                  <th key={a.id}>{a.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.points.map((p) => (
                <tr key={p.date}>
                  <td>{p.date}</td>
                  <td>{fmt.full(p.total, data.currency)}</td>
                  {data.accounts.map((a) => (
                    <td key={a.id}>{fmt.full(p.byAccount[a.id] ?? 0, data.currency)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : undefined
      }
    >
      {data ? (
        <>
          <p className="mb-3 flex flex-wrap items-baseline gap-x-3 text-[0.9375rem]">
            <span className="font-display-num text-2xl">
              <AmountText minor={last} currency={data.currency} compactFraction />
            </span>
            <span className="text-muted">now,</span>
            <span>
              <AmountText
                minor={last - first}
                currency={data.currency}
                kind="delta"
                compactFraction
              />
            </span>
            <span className="text-muted">over this range</span>
          </p>
          {showAccounts && !single ? (
            <Legend
              items={[
                { label: 'Net worth', color: 'var(--ink)' },
                ...data.accounts.map((a, i) => ({ label: a.name, color: sliceColor(i) })),
              ]}
            />
          ) : null}
          <div className={HEIGHT}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                accessibilityLayer={false}
                data={rows}
                margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
              >
                <CartesianGrid vertical={false} stroke="var(--rule)" />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={{ stroke: 'var(--rule-strong)' }}
                  tick={CHART_AXIS}
                  interval="preserveStartEnd"
                  minTickGap={24}
                />
                <YAxis
                  width={56}
                  tickLine={false}
                  axisLine={false}
                  tick={CHART_AXIS}
                  tickFormatter={yTick(data.currency, user.locale)}
                  {...niceY(false)}
                />
                <ReferenceLine y={0} stroke="var(--rule-strong)" />
                <Tooltip
                  content={(p: TooltipContentProps<ValueType, NameType>) =>
                    p.active && p.payload?.length ? (
                      <TooltipBox
                        title={format(
                          parseISO((p.payload[0]!.payload as { date: string }).date),
                          'EEEE, MMM d',
                        )}
                        rows={[
                          {
                            label: 'Net worth',
                            value: fmt.full(
                              Math.round(
                                Number((p.payload[0]!.payload as { total$: number }).total$) *
                                  10 ** currencyExponent(data.currency),
                              ),
                              data.currency,
                            ),
                            strong: true,
                          },
                          ...(showAccounts && !single
                            ? data.accounts.map((a, i) => ({
                                label: a.name,
                                value: fmt.full(
                                  Math.round(
                                    Number(
                                      (p.payload![0]!.payload as Record<string, number>)[a.id],
                                    ) *
                                      10 ** currencyExponent(data.currency),
                                  ),
                                  data.currency,
                                ),
                                swatch: sliceColor(i),
                              }))
                            : []),
                        ]}
                      />
                    ) : null
                  }
                />
                {showAccounts && !single
                  ? data.accounts.map((a, i) => (
                      <Line
                        key={a.id}
                        type="stepAfter"
                        dataKey={a.id}
                        name={a.name}
                        stroke={sliceColor(i)}
                        strokeWidth={1.5}
                        dot={false}
                        isAnimationActive={false}
                      />
                    ))
                  : null}
                <Line
                  type="stepAfter"
                  dataKey="total$"
                  name="Net worth"
                  stroke="var(--ink)"
                  strokeWidth={2.5}
                  dot={false}
                  isAnimationActive={!reducedMotion()}
                  animationDuration={400}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          {data.excludedCurrencies.length > 0 ? (
            <ScopeNote>{`${data.excludedCurrencies.join(', ')} accounts are not included: Ledger doesn't convert between currencies.`}</ScopeNote>
          ) : null}
          <ScopeNote>Category and type filters don't apply to balances.</ScopeNote>
        </>
      ) : (
        <span />
      )}
    </ChartCard>
  );
}

// ------------------------------------------------------------------ savings progress

export function SavingsProgress({ query, ready }: { query: Q; ready: boolean }) {
  const user = useCurrentUser();
  const fmt = useMoneyFormat();
  const savings = useSavingsProgress(
    {
      range: query.range,
      ...(query.from ? { from: query.from } : {}),
      ...(query.to ? { to: query.to } : {}),
    },
    ready,
  );
  const data = savings.data;
  const rows = useMemo(
    () =>
      data
        ? data.points.map((p) => ({
            ...p,
            label: dateLabel(p.date),
            total$: toMajor(p.total, data.currency),
          }))
        : [],
    [data],
  );
  const empty = data && data.goals.length === 0;
  const start = data?.points[0]?.total ?? 0;
  const end = data?.points.at(-1)?.total ?? 0;
  return (
    <ChartCard
      title="Am I building my savings?"
      description="Total set aside for your goals"
      loading={ready ? savings.isPending : false}
      summary={
        data
          ? `Area chart of savings toward goals, from ${fmt.full(start, data.currency)} to ${fmt.full(end, data.currency)}.`
          : 'Savings progress'
      }
      empty={
        savings.isError
          ? errorEmpty
          : !ready || empty
            ? {
                title: 'No savings goals yet',
                description: 'Create a goal and add to it to see your savings build up here.',
              }
            : undefined
      }
      dataTable={
        data ? (
          <table>
            <caption>Total saved over time</caption>
            <thead>
              <tr>
                <th>Date</th>
                <th>Saved</th>
              </tr>
            </thead>
            <tbody>
              {data.points.map((p) => (
                <tr key={p.date}>
                  <td>{p.date}</td>
                  <td>{fmt.full(p.total, data.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : undefined
      }
    >
      {data ? (
        <>
          <p className="mb-3 text-[0.9375rem]">
            <span className="font-display-num text-2xl">
              <AmountText minor={end} currency={data.currency} compactFraction />
            </span>{' '}
            <span className="text-muted">saved so far,</span>{' '}
            <AmountText minor={end - start} currency={data.currency} kind="delta" compactFraction />{' '}
            <span className="text-muted">over this range</span>
          </p>
          <div className={HEIGHT}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                accessibilityLayer={false}
                data={rows}
                margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
              >
                <CartesianGrid vertical={false} stroke="var(--rule)" />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={{ stroke: 'var(--rule-strong)' }}
                  tick={CHART_AXIS}
                  interval="preserveStartEnd"
                  minTickGap={24}
                />
                <YAxis
                  {...niceY()}
                  width={52}
                  tickLine={false}
                  axisLine={false}
                  tick={CHART_AXIS}
                  tickFormatter={yTick(data.currency, user.locale)}
                />
                <Tooltip
                  content={(p: TooltipContentProps<ValueType, NameType>) =>
                    p.active && p.payload?.length ? (
                      <TooltipBox
                        title={format(
                          parseISO((p.payload[0]!.payload as { date: string }).date),
                          'EEEE, MMM d',
                        )}
                        rows={[
                          {
                            label: 'Saved',
                            value: fmt.full(
                              (p.payload[0]!.payload as { total: number }).total,
                              data.currency,
                            ),
                            strong: true,
                          },
                        ]}
                      />
                    ) : null
                  }
                />
                <Area
                  type="stepAfter"
                  dataKey="total$"
                  name="Saved"
                  stroke="var(--accent)"
                  strokeWidth={2}
                  fill="var(--accent)"
                  fillOpacity={0.15}
                  isAnimationActive={!reducedMotion()}
                  animationDuration={400}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-5 space-y-3">
            {data.goals.map((g) => (
              <li key={g.id}>
                <div className="flex items-baseline justify-between gap-3 text-[0.9375rem]">
                  <span className="font-medium">{g.name}</span>
                  <span className="num text-[0.8125rem] text-muted">
                    {fmt.whole(g.current, data.currency)} of {fmt.whole(g.target, data.currency)} ·{' '}
                    {Math.round(g.progressBp / 100)}%
                  </span>
                </div>
                <ProgressBar
                  basisPoints={g.progressBp}
                  tone={g.progressBp >= 10000 ? 'gain' : 'accent'}
                  label={`${g.name}, ${Math.round(g.progressBp / 100)}% saved`}
                  className="mt-1.5"
                />
              </li>
            ))}
          </ul>
          <ScopeNote>Only the date range applies to savings.</ScopeNote>
        </>
      ) : (
        <span />
      )}
    </ChartCard>
  );
}

// ------------------------------------------------------------------ budget performance

export function BudgetPerformance() {
  const fmt = useMoneyFormat();
  const perf = useBudgetPerformance();
  const data = perf.data;
  // Skip months before any budget existed: they are just a column of dots.
  const columns = useMemo(() => {
    if (!data) return [];
    const all = data.months.map((_, i) => i);
    const first = all.find((i) => data.budgets.some((b) => b.results[i] != null));
    return first === undefined ? all : all.filter((i) => i >= first);
  }, [data]);
  return (
    <ChartCard
      title="Do I keep to my budgets?"
      description="Monthly budgets over the last six months"
      loading={perf.isPending}
      summary={
        data
          ? `Grid of ${data.budgets.length} monthly budgets over six months. Every budget was kept in ${data.monthsWithinBudget} of ${data.monthsEvaluated} completed months.`
          : 'Budget performance'
      }
      empty={
        perf.isError
          ? errorEmpty
          : data && data.budgets.length === 0
            ? {
                title: 'No monthly budgets yet',
                description: 'Set a budget to see how well you keep to it, month after month.',
              }
            : undefined
      }
    >
      {data ? (
        <>
          {data.monthsEvaluated > 0 ? (
            <p className="mb-3 text-[0.9375rem]">
              You kept <strong>every</strong> budget in{' '}
              <Badge tone={data.monthsWithinBudget === data.monthsEvaluated ? 'gain' : 'warn'}>
                {data.monthsWithinBudget} of {data.monthsEvaluated}
              </Badge>{' '}
              completed months.
            </p>
          ) : (
            <p className="mb-3 text-muted">
              Your first full month of budgets will show up here once it ends.
            </p>
          )}
          <div
            className="relative overflow-x-auto"
            role="region"
            aria-label="Budget performance table, scrolls sideways"
            tabIndex={0}
          >
            <table className="w-full min-w-[34rem] border-collapse text-[0.8125rem]">
              <caption className="sr-only">Spent against limit for each budget and month</caption>
              <thead>
                <tr className="border-b border-rule text-left text-muted">
                  <th scope="col" className="py-1.5 pr-3 font-medium">
                    Budget
                  </th>
                  {columns
                    .map((i) => data.months[i]!)
                    .map((m) => (
                      <th
                        key={m.from}
                        scope="col"
                        className="px-1.5 py-1.5 text-center font-medium"
                      >
                        {format(parseISO(m.from), 'MMM')}
                        {m.partial ? (
                          <span className="block text-[0.6875rem] font-normal">so far</span>
                        ) : null}
                      </th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {data.budgets.map((b) => (
                  <tr key={b.id} className="border-b border-rule last:border-b-0">
                    <th scope="row" className="py-2 pr-3 text-left font-normal">
                      <span className="font-medium">{b.name}</span>
                      <span className="block text-muted">
                        {fmt.whole(b.limit, data.currency)} a month
                      </span>
                    </th>
                    {columns
                      .map((i) => [b.results[i] ?? null, i] as const)
                      .map(([r, i]) => (
                        <td key={data.months[i]!.from} className="px-1 py-1.5 text-center">
                          {r === null ? (
                            <span className="text-muted" aria-label="No budget yet">
                              ·
                            </span>
                          ) : (
                            <span
                              className={cn(
                                'inline-block min-w-14 rounded-sm px-1.5 py-1',
                                r.over ? 'bg-loss-wash text-loss' : 'bg-gain-wash text-gain',
                              )}
                              title={`${fmt.full(r.spent, data.currency)} of ${fmt.full(b.limit, data.currency)}`}
                            >
                              <span aria-hidden>{r.over ? '▲' : '✓'} </span>
                              <span className="num">{Math.round((r.spent * 100) / b.limit)}%</span>
                              <span className="sr-only">
                                {r.over ? ', over budget' : ', within budget'}:{' '}
                                {fmt.full(r.spent, data.currency)} of{' '}
                                {fmt.full(b.limit, data.currency)}
                              </span>
                            </span>
                          )}
                        </td>
                      ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ScopeNote>
            Uses each budget's current limit. The date range and filters above don't apply here.
          </ScopeNote>
        </>
      ) : (
        <span />
      )}
    </ChartCard>
  );
}
