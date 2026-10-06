import {
  absMoney,
  formatMoney,
  negateMoney,
  type FormatMoneyOptions,
  type Money,
} from '@pfm/finance';
import { cn } from '../lib/cn';

export type AmountKind = 'income' | 'expense' | 'transfer' | 'neutral' | 'delta';

export interface AmountProps {
  /** For income/expense pass the positive magnitude stored on the transaction. */
  money: Money;
  kind?: AmountKind;
  /** Color the value. Meaning is ALWAYS also conveyed by the explicit +/− sign, never by color alone. */
  tone?: boolean;
  compactFraction?: boolean;
  locale?: string;
  className?: string;
}

const KIND_LABEL: Record<AmountKind, string | null> = {
  income: 'Income',
  expense: 'Expense',
  transfer: 'Transfer',
  neutral: null,
  delta: null,
};

function toneClass(kind: AmountKind, value: Money): string {
  if (kind === 'transfer' || value.minor === 0) return '';
  if (kind === 'income') return 'text-gain';
  if (kind === 'expense') return 'text-loss';
  if (kind === 'delta') return value.minor > 0 ? 'text-gain' : 'text-loss';
  return value.minor < 0 ? 'text-loss' : '';
}

/** Signed, tabular money. `neutral` shows the sign only when negative (balances, debts). */
export function Amount({
  money,
  kind = 'neutral',
  tone = true,
  compactFraction,
  locale,
  className,
}: AmountProps) {
  let value = money;
  let signDisplay: FormatMoneyOptions['signDisplay'] = 'auto';
  if (kind === 'income') {
    value = absMoney(money);
    signDisplay = 'always';
  } else if (kind === 'expense') {
    value = negateMoney(absMoney(money));
  } else if (kind === 'delta') {
    signDisplay = 'always';
  } else if (kind === 'transfer') {
    value = absMoney(money);
  }

  const text = formatMoney(value, {
    signDisplay,
    ...(compactFraction !== undefined ? { compactFraction } : {}),
    ...(locale ? { locale } : {}),
  });
  const color = tone ? toneClass(kind, value) : '';
  const label = KIND_LABEL[kind];

  return (
    <span className={cn('num whitespace-nowrap', color, className)}>
      {label ? <span className="sr-only">{label}: </span> : null}
      {text}
    </span>
  );
}
