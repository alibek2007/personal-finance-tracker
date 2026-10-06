import { useState, type ReactNode } from 'react';
import { Plus, Target } from 'lucide-react';
import { money, type CurrencyCode } from '@pfm/finance';
import {
  Amount,
  Avatar,
  Badge,
  BudgetProgress,
  Button,
  ChartCard,
  Dialog,
  DialogContent,
  DialogTrigger,
  EmptyState,
  Field,
  GoalProgress,
  Input,
  MoneyInput,
  SegmentedControl,
  Select,
  Skeleton,
  Stat,
  toast,
} from '@pfm/ui';

const usd = (minor: number) => money(minor, 'USD');

const SWATCHES = [
  ['bg', 'Page'],
  ['surface', 'Surface'],
  ['sunk', 'Wells, inputs'],
  ['rule', 'Hairlines'],
  ['ink', 'Primary text'],
  ['muted', 'Secondary text'],
  ['accent', 'Action, focus'],
  ['gain', 'Income, gains'],
  ['loss', 'Expenses, losses'],
  ['warn', 'Thresholds'],
] as const;

const RANGES = [
  { value: '7d', label: '7D', ariaLabel: 'Last 7 days' },
  { value: '30d', label: '30D', ariaLabel: 'Last 30 days' },
  { value: '3m', label: '3M', ariaLabel: 'Last 3 months' },
  { value: '6m', label: '6M', ariaLabel: 'Last 6 months' },
  { value: '1y', label: '1Y', ariaLabel: 'Last year' },
] as const;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-rule py-8">
      <h2 className="mb-5 font-display text-2xl">{title}</h2>
      {children}
    </section>
  );
}

/** Living reference for the design system. Values are illustrative sample data, not user data. */
export function DesignSystemPage() {
  const [range, setRange] = useState<(typeof RANGES)[number]['value']>('30d');
  const [amount, setAmount] = useState<number | null>(1999);
  const [currency, setCurrency] = useState<CurrencyCode>('USD');

  return (
    <div>
      <h1 className="font-display text-4xl">Design system</h1>
      <p className="mt-2 max-w-prose text-muted">
        Tokens and components that every screen is built from. Sample figures below are
        illustrative.
      </p>

      <Section title="Colour">
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          {SWATCHES.map(([token, use]) => (
            <li key={token}>
              <div
                className="h-14 rounded-md border border-rule"
                style={{ background: `var(--${token})` }}
              />
              <p className="mt-1.5 font-medium">{token}</p>
              <p className="text-[0.8125rem] text-muted">{use}</p>
            </li>
          ))}
        </ul>
        <ul className="mt-6 flex flex-wrap gap-1" aria-label="Chart palette">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
            <li
              key={n}
              className="h-8 w-12 rounded-sm"
              style={{ background: `var(--chart-${n})` }}
            />
          ))}
        </ul>
      </Section>

      <Section title="Typography and numbers">
        <div className="grid gap-8 lg:grid-cols-2">
          <dl>
            <Stat
              label="Total balance"
              size="large"
              note={<Amount money={usd(32000)} kind="delta" />}
            >
              <Amount money={usd(1245000)} compactFraction />
            </Stat>
          </dl>
          <dl className="grid grid-cols-3 gap-4">
            <Stat label="Income">
              <Amount money={usd(480000)} kind="income" compactFraction />
            </Stat>
            <Stat label="Spent">
              <Amount money={usd(293000)} kind="expense" compactFraction />
            </Stat>
            <Stat label="Saved">
              <Amount money={usd(187000)} kind="delta" compactFraction />
            </Stat>
          </dl>
        </div>
        <table className="mt-8 w-full max-w-md text-[0.9375rem]">
          <caption className="sr-only">Tabular figures align by decimal</caption>
          <tbody>
            {[
              ['Salary', usd(480000), 'income'],
              ['Rent', usd(185000), 'expense'],
              ['Coffee', usd(450), 'expense'],
              ['Credit card balance', usd(-82000), 'neutral'],
            ].map(([label, value, kind]) => (
              <tr key={String(label)} className="border-b border-rule">
                <th scope="row" className="py-2 text-left font-normal">
                  {String(label)}
                </th>
                <td className="py-2 text-right">
                  <Amount
                    money={value as ReturnType<typeof usd>}
                    kind={kind as 'income' | 'expense' | 'neutral'}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Buttons and controls">
        <div className="flex flex-wrap items-center gap-3">
          <Button>
            <Plus aria-hidden /> Add expense
          </Button>
          <Button variant="secondary">Move money</Button>
          <Button variant="ghost">Cancel</Button>
          <Button variant="danger">Delete transaction</Button>
          <Button loading>Saving…</Button>
          <Button disabled>Unavailable</Button>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-6">
          <SegmentedControl label="Date range" options={RANGES} value={range} onChange={setRange} />
          <div className="flex gap-2">
            <Badge>Neutral</Badge>
            <Badge tone="accent">Recurring</Badge>
            <Badge tone="gain">On track</Badge>
            <Badge tone="warn">82% used</Badge>
            <Badge tone="loss">Over budget</Badge>
          </div>
          <Avatar name="Alex Morgan" />
        </div>
      </Section>

      <Section title="Forms">
        <form className="grid max-w-xl gap-4 sm:grid-cols-2" onSubmit={(e) => e.preventDefault()}>
          <Field label="Amount" hint="Type 19.99 or paste $19.99">
            <MoneyInput value={amount} onChange={setAmount} currency={currency} />
          </Field>
          <Field label="Currency">
            <Select value={currency} onChange={(e) => setCurrency(e.target.value as CurrencyCode)}>
              {(['USD', 'EUR', 'GBP', 'KZT', 'RUB', 'JPY'] as const).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label="Description">
            <Input placeholder="Lunch with Sam" />
          </Field>
          <Field label="With an error" error="Enter an amount greater than zero">
            <Input defaultValue="0" />
          </Field>
          <p className="num text-[0.8125rem] text-muted sm:col-span-2">
            Stored value: {amount === null ? 'empty' : `${amount} minor units`}
          </p>
        </form>
      </Section>

      <Section title="Progress">
        <div className="grid max-w-3xl gap-8 md:grid-cols-2">
          <BudgetProgress
            name="Food"
            spent={usd(32000)}
            limit={usd(50000)}
            elapsedBasisPoints={5500}
          />
          <BudgetProgress
            name="Entertainment"
            spent={usd(12800)}
            limit={usd(15000)}
            elapsedBasisPoints={5500}
          />
          <BudgetProgress
            name="Shopping"
            spent={usd(23400)}
            limit={usd(20000)}
            elapsedBasisPoints={5500}
          />
          <GoalProgress
            name="Laptop"
            current={usd(120000)}
            target={usd(200000)}
            detail="$267/month to reach it by June"
          />
        </div>
      </Section>

      <Section title="Charts, empty and loading states">
        <div className="grid gap-8 md:grid-cols-2">
          <ChartCard
            title="Where did my money go?"
            description="Spending by category"
            empty={{ title: 'Add a few transactions to unlock your spending insights.' }}
          >
            <span />
          </ChartCard>
          <ChartCard title="Loading example" loading>
            <span />
          </ChartCard>
        </div>
        <div className="mt-8 flex items-center gap-4">
          <Skeleton className="size-9 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
        <EmptyState
          icon={<Target />}
          title="You haven't set a savings goal yet"
          description="Goals turn a vague wish into a monthly number you can act on."
          action={<Button>Create goal</Button>}
        />
      </Section>

      <Section title="Overlays and feedback">
        <div className="flex flex-wrap gap-3">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="secondary">Open dialog</Button>
            </DialogTrigger>
            <DialogContent
              title="Delete this transaction?"
              description="Balances will be updated. This cannot be undone."
            >
              <div className="flex justify-end gap-2">
                <Button variant="ghost">Keep it</Button>
                <Button variant="danger">Delete</Button>
              </div>
            </DialogContent>
          </Dialog>
          <Button variant="secondary" onClick={() => toast.success('Expense saved')}>
            Success toast
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              toast.error("Couldn't save this transaction. Check your connection and try again.")
            }
          >
            Error toast
          </Button>
        </div>
      </Section>
    </div>
  );
}
