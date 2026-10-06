import { useController, type Control, type FieldValues, type Path } from 'react-hook-form';
import type { CurrencyCode } from '@pfm/finance';
import { MoneyInput } from '@pfm/ui';

interface Props<T extends FieldValues> {
  control: Control<T>;
  name: Path<T>;
  currency: CurrencyCode;
  allowNegative?: boolean;
  autoFocus?: boolean;
  /** What an empty box means in the form state (the API wants `undefined`, `null` or `0` in different places). */
  emptyValue?: null | undefined | 0;
  // Injected by <Field/> so the label, hint and error text are wired to the real <input>.
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}

/**
 * react-hook-form binding for MoneyInput. It must be a component (not a render prop inside
 * <Controller/>) so <Field/> can pass `id` and ARIA attributes straight through to the input.
 */
export function ControlledMoneyInput<T extends FieldValues>({
  control,
  name,
  currency,
  allowNegative,
  autoFocus,
  emptyValue = null,
  ...aria
}: Props<T>) {
  const { field } = useController({ control, name });
  return (
    <MoneyInput
      {...aria}
      // Lets react-hook-form focus this input (setFocus, and the first invalid field on submit).
      ref={field.ref}
      value={(field.value as number | null | undefined) ?? null}
      onChange={(minor) => field.onChange(minor ?? emptyValue)}
      currency={currency}
      {...(allowNegative !== undefined ? { allowNegative } : {})}
      {...(autoFocus !== undefined ? { autoFocus } : {})}
    />
  );
}
