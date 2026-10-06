import { useId } from 'react';
import { cn } from '../lib/cn';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Longer accessible name, e.g. "Last 7 days" for label "7D". */
  ariaLabel?: string;
}

export interface SegmentedControlProps<T extends string> {
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

/** Native radio inputs: free arrow-key navigation and screen-reader semantics. */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: SegmentedControlProps<T>) {
  const name = useId();
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('inline-flex rounded-md border border-rule-strong bg-sunk p-0.5', className)}
    >
      {options.map((option) => (
        <label
          key={option.value}
          className="relative cursor-pointer select-none rounded-[5px] px-3 py-1 text-[0.8125rem] font-medium text-muted transition-colors duration-[var(--dur-micro)] has-[:checked]:bg-surface has-[:checked]:text-ink has-[:checked]:shadow-[0_0_0_1px_var(--rule)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-accent"
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={option.value === value}
            onChange={() => onChange(option.value)}
            aria-label={option.ariaLabel ?? option.label}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}
