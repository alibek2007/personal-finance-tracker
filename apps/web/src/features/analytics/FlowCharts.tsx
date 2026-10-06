import { useMemo } from 'react';
import { format, parseISO } from 'date-fns';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent';
import { currencyExponent, type CurrencyCode } from '@pfm/finance';
import { ChartCard, ProgressBar, Stat } from '@pfm/ui';
import type { AnalyticsQuery } from '@pfm/validation';
import { AmountText } from '../../components/LedgerBits';
import { useCurrentUser } from '../../lib/auth';
import {
  useCashFlow,
  useCategoryBreakdown,
  useSpendingTrend,
  useSummary,
} from '../../lib/analytics';
import {
  bucketLabel,
  bucketTitle,
  compactMoney,
  niceY,
  reducedMotion,
  sliceColor,
  toMajor,
} from '../dashboard/chart-utils';
import { CHART_AXIS, ChangeText, Legend, ScopeNote, TooltipBox, useMoneyFormat } from './chart-kit';

type Q = Partial<AnalyticsQuery>;
interface Props {
  query: Q;
  ready: boolean;
}

const CHART_HEIGHT = 'h-64 w-full';
const errorEmpty = {
  title: "Couldn't load this chart",
  description: 'Check your connection and reload the page.',
};
const pending = (ready: boolean) => !ready;

function yTick(currency: CurrencyCode, locale: string) {
  return (v: number) =>
    compactMoney(Math.round(v * 10 ** currencyExponent(currency)), currency, locale);
}

// ------------------------------------------------------------------ summary

export function SummaryStrip({ query, ready }: Props) {
  const summary = useSummary(query, ready);
  const data = summary.data;
  if (!ready)
    return <p className="mt-6 text-muted">Choose a start and end date to see your numbers.</p>;
  if (summary.isPending)
    return <div role="status" aria-label="Loading summary" className="mt-6 h-24" />;
  if (summary.isError || !data)
    return (
      <p className="mt-6 text-muted">
        Couldn't load the summary. Check your connection and reload.
      </p>
    );
  const versus = 'the previous period';
  const rate = data.current.savingsRateBp;
  return (
    <section aria-label="Summary" className="mt-6 border-b border-rule pb-8">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4">
        <Stat
          label="Income"
          note={<ChangeText bp={data.changes.incomeBp} good="up" versus={versus} />}
        >
          <AmountText
            minor={data.current.income}
            currency={data.currency}
            kind="income"
            compactFraction
          />
        </Stat>
        <Stat
          label="Spent"
          note={<ChangeText bp={data.changes.spentBp} good="down" versus={versus} />}
        >
          <AmountText
            minor={data.current.spent}
            currency={data.currency}
            kind="expense"
            compactFraction
          />
        </Stat>
        <Stat label="Net" note={<ChangeText bp={data.changes.savedBp} good="up" versus={versus} />}>
          <AmountText
            minor={data.current.saved}
            currency={data.currency}
            kind="delta"
            compactFraction
          />
        </Stat>
        <Stat
          label="Savings rate"
          note={rate === null ? 'Needs some income first' : 'Of income, kept'}
        >
          {rate === null ? (
            <span className="text-muted">n/a</span>
          ) : (
            <span className="num">{`${Math.round(rate / 100)}%`}</span>
          )}
        </Stat>
      </dl>
      {data.dataStartsOn && data.previous.from < data.dataStartsOn ? (
        <p className="mt-4 text-[0.8125rem] text-muted">
          Your records start on {format(parseISO(data.dataStartsOn), 'MMM d, yyyy')}, so the
          previous period is only partly covered and these comparisons can look exaggerated.
        </p>
      ) : null}
      {data.excludedCurrencies.length > 0 ? (
        <p className="mt-4 text-[0.8125rem] text-muted">
          {data.excludedCurrencies.join(', ')} transactions are not included: Ledger doesn't convert
          between currencies.
        </p>
      ) : null}
    </section>
  );
}

// ------------------------------------------------------------------ income vs spending, and net

function useFlowRows(query: Q, ready: boolean) {
  const flow = useCashFlow(query, ready);
  const data = flow.data;
  const rows = useMemo(
    () =>
      data
        ? data.points.map((p) => ({
            ...p,
            label: bucketLabel(p.start, p.end, data.unit),
            income$: toMajor(p.income, data.currency),
            expenses$: toMajor(p.expenses, data.currency),
            net$: toMajor(p.net, data.currency),
          }))
        : [],
    [data],
  );
  return { flow, data, rows };
}

function FlowTooltip({
  active,
  payload,
  unit,
  currency,
  mode,
}: TooltipContentProps<ValueType, NameType> & {
  unit: 'day' | 'week' | 'month';
  currency: CurrencyCode;
  mode: 'both' | 'net';
}) {
  const fmt = useMoneyFormat();
  if (!active || !payload?.length) return null;
  const row = payload[0]!.payload as {
    start: string;
    end: string;
    income: number;
    expenses: number;
    net: number;
  };
  const rows =
    mode === 'both'
      ? [
          { label: 'Income', value: fmt.full(row.income, currency, true) },
          { label: 'Spent', value: fmt.full(-row.expenses, currency) },
          { label: 'Net', value: fmt.full(row.net, currency, true), strong: true },
        ]
      : [
          { label: 'Income', value: fmt.full(row.income, currency, true) },
          { label: 'Spent', value: fmt.full(-row.expenses, currency) },
          {
            label: row.net >= 0 ? 'Saved' : 'Spent more than earned',
            value: fmt.full(row.net, currency, true),
            strong: true,
          },
        ];
  return <TooltipBox title={bucketTitle(row.start, row.end, unit)} rows={rows} />;
}

export function IncomeVsSpending({ query, ready }: Props) {
  const user = useCurrentUser();
  const fmt = useMoneyFormat();
  const { flow, data, rows } = useFlowRows(query, ready);
  const empty = data && data.points.every((p) => p.income === 0 && p.expenses === 0);
  return (
    <ChartCard
      title="Am I earning more than I spend?"
      description="Income and spending in each period"
      loading={pending(ready) ? false : flow.isPending}
      summary={
        data
          ? `Bar chart of income and spending by ${data.unit}. Total income ${fmt.full(data.totals.income, data.currency)}, total spent ${fmt.full(data.totals.spent, data.currency)}.`
          : 'Income versus spending'
      }
      empty={
        flow.isError
          ? errorEmpty
          : !ready
            ? { title: 'Choose a date range', description: 'Pick a start and end date above.' }
            : empty
              ? {
                  title: 'Nothing recorded in this period',
                  description: 'Add a few transactions, or try a wider range or different filters.',
                }
              : undefined
      }
      dataTable={
        data ? (
          <table>
            <caption>Income and spending by {data.unit}</caption>
            <thead>
              <tr>
                <th>Period</th>
                <th>Income</th>
                <th>Spent</th>
                <th>Net</th>
              </tr>
            </thead>
            <tbody>
              {data.points.map((p) => (
                <tr key={p.start}>
                  <td>{bucketTitle(p.start, p.end, data.unit)}</td>
                  <td>{fmt.full(p.income, data.currency)}</td>
                  <td>{fmt.full(p.expenses, data.currency)}</td>
                  <td>{fmt.full(p.net, data.currency, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : undefined
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
          <div className={CHART_HEIGHT}>
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
                  interval="preserveStartEnd"
                  minTickGap={16}
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
                  content={(p) => (
                    <FlowTooltip {...p} unit={data.unit} currency={data.currency} mode="both" />
                  )}
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
                  dataKey="expenses$"
                  name="Spent"
                  fill="var(--loss)"
                  radius={[2, 2, 0, 0]}
                  isAnimationActive={!reducedMotion()}
                  animationDuration={400}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {data.excludedCurrencies.length > 0 ? (
            <ScopeNote>{`${data.excludedCurrencies.join(', ')} transactions are not included.`}</ScopeNote>
          ) : null}
        </>
      ) : (
        <span />
      )}
    </ChartCard>
  );
}

export function NetCashFlow({ query, ready }: Props) {
  const user = useCurrentUser();
  const fmt = useMoneyFormat();
  const { flow, data, rows } = useFlowRows(query, ready);
  const empty = data && data.points.every((p) => p.income === 0 && p.expenses === 0);
  const positivePeriods = data ? data.points.filter((p) => p.net > 0).length : 0;
  return (
    <ChartCard
      title="Am I saving or spending down?"
      description="What's left after spending, in each period"
      loading={pending(ready) ? false : flow.isPending}
      summary={
        data
          ? `Bar chart of net cash flow by ${data.unit}. ${positivePeriods} of ${data.points.length} periods ended positive. Total net ${fmt.full(data.totals.saved, data.currency, true)}.`
          : 'Net cash flow'
      }
      empty={
        flow.isError
          ? errorEmpty
          : !ready || empty
            ? {
                title: 'Nothing to show yet',
                description: 'Net cash flow appears once there is income or spending in the range.',
              }
            : undefined
      }
      dataTable={
        data ? (
          <table>
            <caption>Net cash flow by {data.unit}</caption>
            <thead>
              <tr>
                <th>Period</th>
                <th>Net</th>
              </tr>
            </thead>
            <tbody>
              {data.points.map((p) => (
                <tr key={p.start}>
                  <td>{bucketTitle(p.start, p.end, data.unit)}</td>
                  <td>{fmt.full(p.net, data.currency, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : undefined
      }
    >
      {data ? (
        <>
          <Legend
            items={[
              { label: 'Saved (above the line)', color: 'var(--gain)' },
              { label: 'Spent more than earned (below)', color: 'var(--loss)' },
            ]}
          />
          <div className={CHART_HEIGHT}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                accessibilityLayer={false}
                data={rows}
                margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
              >
                <CartesianGrid vertical={false} stroke="var(--rule)" />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tick={CHART_AXIS}
                  interval="preserveStartEnd"
                  minTickGap={16}
                />
                <YAxis
                  {...niceY()}
                  width={52}
                  tickLine={false}
                  axisLine={false}
                  tick={CHART_AXIS}
                  tickFormatter={yTick(data.currency, user.locale)}
                />
                <ReferenceLine y={0} stroke="var(--ink)" strokeWidth={1} />
                <Tooltip
                  cursor={{ fill: 'var(--sunk)' }}
                  content={(p) => (
                    <FlowTooltip {...p} unit={data.unit} currency={data.currency} mode="net" />
                  )}
                />
                <Bar
                  dataKey="net$"
                  name="Net"
                  radius={[2, 2, 2, 2]}
                  isAnimationActive={!reducedMotion()}
                  animationDuration={400}
                >
                  {rows.map((r) => (
                    <Cell key={r.start} fill={r.net >= 0 ? 'var(--gain)' : 'var(--loss)'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      ) : (
        <span />
      )}
    </ChartCard>
  );
}

// ------------------------------------------------------------------ ranking by category

export function CategoryRanking({ query, ready }: Props) {
  const fmt = useMoneyFormat();
  // Spending only: an income/expense type filter would make this chart meaningless.
  const { type: _ignored, ...rest } = query;
  const breakdown = useCategoryBreakdown(rest, ready);
  const data = breakdown.data;
  const max = data?.slices[0]?.amount ?? 0;
  const link = (categoryId: string | null) => {
    const p = new URLSearchParams({ type: 'expense', from: data?.from ?? '', to: data?.to ?? '' });
    if (categoryId) p.set('category', categoryId);
    else p.set('uncategorized', 'true');
    return `/transactions?${p.toString()}`;
  };
  return (
    <ChartCard
      interactive
      title="Where does it go?"
      description="Spending by category, biggest first"
      loading={pending(ready) ? false : breakdown.isPending}
      summary={
        data
          ? `Ranking of ${data.slices.length} spending categories totalling ${fmt.full(data.total, data.currency)}. Largest: ${data.slices[0]?.name ?? 'none'}.`
          : 'Spending by category'
      }
      empty={
        breakdown.isError
          ? errorEmpty
          : !ready || (data && data.slices.length === 0)
            ? {
                title: 'No spending in this range',
                description: 'Add a few expenses, or try a wider range.',
              }
            : undefined
      }
    >
      {data ? (
        <ol>
          {data.slices.map((s, i) => (
            <li
              key={s.categoryId ?? 'none'}
              className="border-b border-rule py-2.5 last:border-b-0"
            >
              <details className="group">
                <summary className="flex cursor-pointer list-none items-center gap-3 [&::-webkit-details-marker]:hidden">
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-sm"
                    style={{ background: sliceColor(i) }}
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                  <span className="num text-[0.8125rem] text-muted">
                    {s.shareBp < 100 ? '<1%' : `${Math.round(s.shareBp / 100)}%`}
                  </span>
                  <span className="num w-24 text-right font-medium">
                    {fmt.whole(s.amount, data.currency)}
                  </span>
                </summary>
                <div className="mt-2 pl-5.5">
                  <ProgressBar
                    basisPoints={max > 0 ? Math.round((s.amount * 10000) / max) : 0}
                    label={`${s.name}, ${Math.round(s.shareBp / 100)}% of spending`}
                  />
                  {s.children.length > 1 ? (
                    <ul className="mt-2 text-[0.8125rem]">
                      {s.children.map((c) => (
                        <li
                          key={c.categoryId ?? 'direct'}
                          className="flex justify-between py-0.5 text-muted"
                        >
                          <span>{c.name}</span>
                          <span className="num">{fmt.whole(c.amount, data.currency)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <Link
                    to={link(s.categoryId)}
                    className="mt-2 inline-block text-[0.8125rem] font-medium text-accent hover:underline"
                  >
                    See these transactions
                  </Link>
                </div>
              </details>
            </li>
          ))}
        </ol>
      ) : (
        <span />
      )}
    </ChartCard>
  );
}

// ------------------------------------------------------------------ spending over time

function TrendTooltip({
  active,
  payload,
  unit,
  currency,
}: TooltipContentProps<ValueType, NameType> & {
  unit: 'day' | 'week' | 'month';
  currency: CurrencyCode;
}) {
  const fmt = useMoneyFormat();
  if (!active || !payload?.length) return null;
  const row = payload[0]!.payload as { start: string; end: string; total: number };
  const rows = payload
    .filter((p) => Number(p.value) !== 0)
    .reverse()
    .map((p) => ({
      label: String(p.name),
      value: fmt.full(Math.round(Number(p.value) * 10 ** currencyExponent(currency)), currency),
      swatch: String(p.color),
    }));
  return (
    <TooltipBox
      title={bucketTitle(row.start, row.end, unit)}
      rows={[...rows, { label: 'Total', value: fmt.full(row.total, currency), strong: true }]}
    />
  );
}

export function SpendingOverTime({ query, ready }: Props) {
  const user = useCurrentUser();
  const fmt = useMoneyFormat();
  const { type: _ignored, ...rest } = query;
  const trend = useSpendingTrend(rest, ready);
  const data = trend.data;
  const colors = useMemo(
    () =>
      new Map(
        (data?.series ?? []).map((s, i) => [
          s.key,
          s.key === 'other' ? 'var(--rule-strong)' : sliceColor(i),
        ]),
      ),
    [data],
  );
  const rows = useMemo(
    () =>
      data
        ? data.points.map((p) => ({
            start: p.start,
            end: p.end,
            total: p.total,
            label: bucketLabel(p.start, p.end, data.unit),
            ...Object.fromEntries(
              data.series.map((s) => [s.key, toMajor(p.values[s.key] ?? 0, data.currency)]),
            ),
          }))
        : [],
    [data],
  );
  const empty = data && data.series.length === 0;
  return (
    <ChartCard
      title="How is my spending changing?"
      description="Spending in each period, by category"
      loading={pending(ready) ? false : trend.isPending}
      summary={
        data
          ? `Stacked bar chart of spending by ${data.unit}, split into ${data.series.map((s) => s.name).join(', ')}.`
          : 'Spending over time'
      }
      empty={
        trend.isError
          ? errorEmpty
          : !ready || empty
            ? {
                title: 'No spending in this range',
                description: 'Add a few expenses, or try a wider range.',
              }
            : undefined
      }
      dataTable={
        data ? (
          <table>
            <caption>Spending by {data.unit} and category</caption>
            <thead>
              <tr>
                <th>Period</th>
                {data.series.map((s) => (
                  <th key={s.key}>{s.name}</th>
                ))}
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {data.points.map((p) => (
                <tr key={p.start}>
                  <td>{bucketTitle(p.start, p.end, data.unit)}</td>
                  {data.series.map((s) => (
                    <td key={s.key}>{fmt.full(p.values[s.key] ?? 0, data.currency)}</td>
                  ))}
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
          <Legend
            items={data.series.map((s) => ({
              label: s.name,
              color: colors.get(s.key) ?? 'var(--rule-strong)',
            }))}
          />
          <div className={CHART_HEIGHT}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                accessibilityLayer={false}
                data={rows}
                margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
              >
                <CartesianGrid vertical={false} stroke="var(--rule)" />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={{ stroke: 'var(--rule-strong)' }}
                  tick={CHART_AXIS}
                  interval="preserveStartEnd"
                  minTickGap={16}
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
                  content={(p) => <TrendTooltip {...p} unit={data.unit} currency={data.currency} />}
                />
                {data.series.map((s) => (
                  <Bar
                    key={s.key}
                    dataKey={s.key}
                    name={s.name}
                    stackId="spend"
                    fill={colors.get(s.key)}
                    isAnimationActive={!reducedMotion()}
                    animationDuration={400}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      ) : (
        <span />
      )}
    </ChartCard>
  );
}
