import { greetingFor, hourInZone } from '@pfm/finance';
import { Stat, useAnimatedNumber, cn } from '@pfm/ui';
import type { OverviewDto } from '@pfm/validation';
import { format, parseISO } from 'date-fns';
import { AmountText } from '../../components/LedgerBits';
import { useCurrentUser } from '../../lib/auth';

export function Greeting() {
  const user = useCurrentUser();
  let part: 'morning' | 'afternoon' | 'evening' = 'morning';
  try {
    part = greetingFor(hourInZone(new Date(), user.timezone));
  } catch {
    part = greetingFor(new Date().getHours());
  }
  const first = user.name.trim().split(/\s+/)[0] ?? user.name;
  return <h1 className="font-display text-4xl">{`Good ${part}, ${first}`}</h1>;
}

/** A change versus last month, in words and a glyph, never colour alone. */
function Change({ bp, good }: { bp: number | null; good: 'up' | 'down' }) {
  if (bp === null) return <span>No data for this point last month</span>;
  if (Math.abs(bp) < 50) return <span>About the same as last month so far</span>;
  const up = bp > 0;
  const better = (up && good === 'up') || (!up && good === 'down');
  const pct = Math.round(Math.abs(bp) / 100);
  return (
    <span className={cn(better ? 'text-gain' : 'text-loss')}>
      <span aria-hidden>{up ? '▲' : '▼'}</span> {pct}% {up ? 'more' : 'less'} than last month so far
    </span>
  );
}

export function Snapshot({ overview }: { overview: OverviewDto }) {
  const { currency, month, changes } = overview;
  const shownBalance = useAnimatedNumber(overview.totalBalance);
  const monthName = format(parseISO(month.from), 'MMMM');
  const rate = month.savingsRateBp;

  return (
    <section aria-label="Financial snapshot" className="border-b border-rule pb-8">
      <div className="mt-2 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] lg:items-end">
        <dl>
          <Stat
            label="Total balance"
            size="large"
            note={
              overview.otherCurrencies.length > 0
                ? `Net worth in ${currency}. You also hold ${overview.otherCurrencies.join(', ')}, shown separately under Accounts.`
                : 'Net worth across all your accounts, after debts'
            }
          >
            <span aria-label={undefined}>
              <AmountText minor={shownBalance} currency={currency} compactFraction />
            </span>
          </Stat>
        </dl>
        <div>
          <p className="mb-3 text-[0.8125rem] text-muted">{monthName} so far</p>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4">
            <Stat label="Income" note={<Change bp={changes.incomeBp} good="up" />}>
              <AmountText minor={month.income} currency={currency} kind="income" compactFraction />
            </Stat>
            <Stat label="Spent" note={<Change bp={changes.spentBp} good="down" />}>
              <AmountText minor={month.spent} currency={currency} kind="expense" compactFraction />
            </Stat>
            <Stat label="Saved" note={<Change bp={changes.savedBp} good="up" />}>
              <AmountText minor={month.saved} currency={currency} kind="delta" compactFraction />
            </Stat>
            <Stat
              label="Savings rate"
              note={
                rate === null
                  ? 'Needs some income first'
                  : rate >= 2000
                    ? 'Of your income, kept'
                    : rate >= 0
                      ? 'Of your income, kept'
                      : 'Spending is above income'
              }
            >
              {rate === null ? (
                <span className="text-muted">n/a</span>
              ) : (
                <span className="num">{`${Math.round(rate / 100)}%`}</span>
              )}
            </Stat>
          </dl>
        </div>
      </div>
    </section>
  );
}
