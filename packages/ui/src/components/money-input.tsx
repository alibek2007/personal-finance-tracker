import { useEffect, useState, type Ref } from 'react';
import {
  currencyExponent,
  CURRENCIES,
  MoneyError,
  parseMoney,
  toDecimalString,
  money,
  type CurrencyCode,
} from '@pfm/finance';
import { cn } from '../lib/cn';
import { Input } from './field';

export interface MoneyInputProps {
  id?: string;
  /** Controlled value in integer minor units; null = empty. */
  value: number | null;
  onChange: (minor: number | null) => void;
  currency: CurrencyCode;
  /** Allow negative values (e.g. opening balance of a credit card). */
  allowNegative?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  ref?: Ref<HTMLInputElement>;
}

/**
 * Amount entry that never touches floats: the text is parsed to exact minor units by @pfm/finance.
 * Shows the currency symbol; accepts "1,234.5", "19.99", pasted "$20".
 */
export function MoneyInput({
  value,
  onChange,
  currency,
  allowNegative = false,
  className,
  ...props
}: MoneyInputProps) {
  const [text, setText] = useState(() =>
    value === null ? '' : toDecimalString(money(value, currency)),
  );

  // Re-sync when the controlled value changes from outside (e.g. form reset, "repeat last").
  useEffect(() => {
    setText((current) => {
      const parsed = tryParse(current, currency);
      if (value === null) return parsed === null ? current : '';
      return parsed === value ? current : toDecimalString(money(value, currency));
    });
  }, [value, currency]);

  function handleChange(next: string) {
    const cleaned = allowNegative ? next : next.replace(/^[-−]/, '');
    setText(cleaned);
    onChange(cleaned.trim() === '' ? null : tryParse(cleaned, currency));
  }

  return (
    <div className="relative">
      <span aria-hidden className="pointer-events-none absolute left-3 top-2.5 text-muted">
        {CURRENCIES[currency].symbol}
      </span>
      <Input
        inputMode="decimal"
        autoComplete="off"
        placeholder={currencyExponent(currency) === 0 ? '0' : '0.00'}
        className={cn('num pl-8 text-right', className)}
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={() => {
          const parsed = tryParse(text, currency);
          if (parsed !== null) setText(toDecimalString(money(parsed, currency)));
        }}
        {...props}
      />
    </div>
  );
}

function tryParse(text: string, currency: CurrencyCode): number | null {
  try {
    return parseMoney(text, currency).minor;
  } catch (error) {
    if (error instanceof MoneyError) return null;
    throw error;
  }
}
