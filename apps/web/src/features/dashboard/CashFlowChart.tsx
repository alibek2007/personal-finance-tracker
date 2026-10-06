import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent';
import { currencyExponent, formatMoney, money } from '@pfm/finance';
import { ChartCard, SegmentedControl } from '@pfm/ui';
import type { CashFlowDto } from '@pfm/validation';
import { AmountText } from '../../components/LedgerBits';
import { useCurrentUser } from '../../lib/auth';
import { useCashFlow } from '../../lib/analytics';
import {
  bucketLabel,
  bucketTitle,
  compactMoney,
  niceY,
  reducedMotion,
  toMajor,
} from './chart-utils';

const RANGES = [
  { value: '7d', label: '7D', ariaLabel: 'Last 7 days' },
  { value: '30d', label: '30D', ariaLabel: 'Last 30 days' },
  { value: '3m', label: '3M', ariaLabel: 'Last 3 months' },
  { value: '6m', label: '6M', ariaLabel: 'Last 6 months' },
  { value: '1y', label: '1Y', ariaLabel: 'Last year' },
] as const;
type Range = (typeof RANGES)[number]['value'];

interface Row {
  start: string;
  end: string;
  label: string;
  income: number;
  expenses: number;
  net: number;
  incomeMinor: number;
  expensesMinor: number;
}

function FlowTooltip({
  active,
  payload,
  unit,
  currency,
  locale,
}: TooltipContentProps<ValueType, NameType> & {
  unit: CashFlowDto['unit'];
  currency: CashFlowDto['currency'];
  locale: string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]!.payload as Row;
  const fmt = (minor: number, signDisplay: 'always' | 'auto' = 'auto') =>
    formatMoney(money(minor, currency), { locale, signDisplay });
  return (
    <div className="rounded-md border border-rule-strong bg-surface px-3 py-2 text-[0.8125rem] shadow-float">
      <p className="mb-1 font-medium">{bucketTitle(row.start, row.end, unit)}</p>
      <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5">
        <dt className="text-muted">Income</dt>
        <dd className="num m-0 text-right">{fmt(row.incomeMinor, 'always')}</dd>
        <dt className="text-muted">Spent</dt>
        <dd className="num m-0 text-right">{fmt(-row.expensesMinor)}</dd>
        <dt className="text-muted">Net</dt>
        <dd className="num m-0 text-right font-medium">
          {fmt(row.incomeMinor - row.expensesMinor, 'always')}
        </dd>
      </dl>
    </div>
  );
}

export function CashFlowChart() {
  const user = useCurrentUser();
  const [range, setRange] = useState<Range>('30d');
  const flow = useCashFlow({ range });
  const data = flow.data;

  const rows = useMemo<Row[]>(
    () =>
      data
        ? data.points.map((p) => ({
            start: p.start,
            end: p.end,
            label: bucketLabel(p.start, p.end, data.unit),
            income: toMajor(p.income, data.currency),
            expenses: toMajor(p.expenses, data.currency),
            net: toMajor(p.net, data.currency),
            incomeMinor: p.income,
            expensesMinor: p.expenses,
          }))
        : [],
    [data],
  );

  const empty = data && data.points.every((p) => p.income === 0 && p.expenses === 0);
  const currency = data?.currency ?? user.currency;
  const summary = data
    ? `Bar chart of income and spending by ${data.unit}, ${data.from} to ${data.to}. Total income ${formatMoney(money(data.totals.income, currency), { locale: user.locale })}, total spent ${formatMoney(money(data.totals.spent, currency), { locale: user.locale })}.`
    : 'Income versus spending';

  return (
    <ChartCard
      title="Money in and out"
      description="Income and spending over time"
      loading={flow.isPending}
      summary={summary}
      empty={
        flow.isError
          ? {
              title: "Couldn't load your cash flow",
              description: 'Check your connection and reload the page.',
            }
          : empty
            ? {
                title: 'Nothing recorded in this period',
                description: 'Add a few transactions, or try a longer range.',
              }
            : undefined
      }
      actions={
        <SegmentedControl label="Date range" options={RANGES} value={range} onChange={setRange} />
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
                  <td>{formatMoney(money(p.income, currency), { locale: user.locale })}</td>
                  <td>{formatMoney(money(p.expenses, currency), { locale: user.locale })}</td>
                  <td>
                    {formatMoney(money(p.net, currency), {
                      locale: user.locale,
                      signDisplay: 'always',
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : undefined
      }
    >
      {data ? (
        <div>
          <dl className="mb-4 flex flex-wrap gap-x-8 gap-y-2 text-[0.9375rem]">
            <div className="flex items-center gap-2">
              <span aria-hidden className="size-2.5 rounded-sm bg-gain" />
              <dt className="text-muted">Income</dt>
              <dd className="m-0 font-medium">
                <AmountText minor={data.totals.income} currency={currency} kind="income" />
              </dd>
            </div>
            <div className="flex items-center gap-2">
              <span aria-hidden className="size-2.5 rounded-sm bg-loss" />
              <dt className="text-muted">Spent</dt>
              <dd className="m-0 font-medium">
                <AmountText minor={data.totals.spent} currency={currency} kind="expense" />
              </dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="text-muted">Net</dt>
              <dd className="m-0 font-medium">
                <AmountText
                  minor={data.totals.saved}
                  currency={currency}
                  kind="delta"
                  tone={false}
                />
              </dd>
            </div>
          </dl>
          <div className="h-64 w-full">
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
                  tick={{ fill: 'var(--muted)', fontSize: 12 }}
                  interval="preserveStartEnd"
                  minTickGap={16}
                />
                <YAxis
                  {...niceY()}
                  width={52}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: 'var(--muted)', fontSize: 12 }}
                  tickFormatter={(v: number) =>
                    compactMoney(
                      Math.round(v * 10 ** currencyExponent(currency)),
                      currency,
                      user.locale,
                    )
                  }
                />
                <Tooltip
                  cursor={{ fill: 'var(--sunk)' }}
                  content={(props) => (
                    <FlowTooltip
                      {...props}
                      unit={data.unit}
                      currency={currency}
                      locale={user.locale}
                    />
                  )}
                />
                <Bar
                  dataKey="income"
                  name="Income"
                  fill="var(--gain)"
                  radius={[2, 2, 0, 0]}
                  isAnimationActive={!reducedMotion()}
                  animationDuration={400}
                />
                <Bar
                  dataKey="expenses"
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
            <p className="mt-3 text-[0.8125rem] text-muted">
              {data.excludedCurrencies.join(', ')} transactions are not included: Ledger doesn't
              convert between currencies.
            </p>
          ) : null}
        </div>
      ) : (
        <span />
      )}
    </ChartCard>
  );
}
