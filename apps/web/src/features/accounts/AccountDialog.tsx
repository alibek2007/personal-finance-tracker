import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { Button, Dialog, DialogContent, Field, Input, Select, cn, toast } from '@pfm/ui';
import { CURRENCIES, CURRENCY_CODES } from '@pfm/finance';
import { ACCOUNT_TYPES } from '@pfm/types';
import { createAccountSchema, type AccountDto, type CreateAccountInput } from '@pfm/validation';
import { ControlledMoneyInput } from '../../components/ControlledMoneyInput';
import { applyApiError } from '../../lib/forms';
import { useCurrentUser } from '../../lib/auth';
import { useCreateAccount, useUpdateAccount } from '../../lib/ledger';
import { FormError } from '../../pages/auth/AuthLayout';
import { ACCOUNT_TYPE_LABELS } from './labels';

const COLORS = [
  '#1f4e5a',
  '#2e6b4b',
  '#b98a2e',
  '#b2432b',
  '#5b6b84',
  '#85687a',
  '#3a3f46',
  '#6f8f72',
];
const DEFAULT_ICON: Record<(typeof ACCOUNT_TYPES)[number], string> = {
  cash: 'banknote',
  bank: 'landmark',
  savings: 'piggy-bank',
  credit_card: 'credit-card',
  investment: 'trending-up',
  other: 'wallet',
};

type FormValues = z.input<typeof createAccountSchema>;

export function AccountDialog({
  open,
  account,
  onOpenChange,
}: {
  open: boolean;
  account: AccountDto | null;
  onOpenChange: (open: boolean) => void;
}) {
  const user = useCurrentUser();
  const create = useCreateAccount();
  const update = useUpdateAccount(account?.id ?? '');
  const [formError, setFormError] = useState<string | null>(null);
  const editing = account !== null;

  const {
    control,
    register,
    handleSubmit,
    setError,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues, unknown, CreateAccountInput>({
    resolver: zodResolver(createAccountSchema),
    defaultValues: account
      ? {
          name: account.name,
          type: account.type,
          institution: account.institution ?? '',
          currency: account.currency,
          initialBalance: account.initialBalance,
          color: account.color,
          icon: account.icon,
        }
      : {
          name: '',
          type: 'bank',
          institution: '',
          currency: user.currency,
          // Empty on purpose: a prefilled "0.00" makes typing append to it. Empty means 0.
          initialBalance: undefined,
          color: COLORS[0]!,
          icon: 'landmark',
        },
  });

  const type = watch('type');
  const currency = watch('currency');
  const color = watch('color');

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const institution = values.institution?.trim() ? values.institution.trim() : null;
    try {
      if (account) {
        await update.mutateAsync({
          name: values.name,
          type: values.type,
          institution,
          initialBalance: values.initialBalance,
          color: values.color,
          icon: values.icon,
        });
        toast.success('Account updated');
      } else {
        await create.mutateAsync({ ...values, institution });
        toast.success(`${values.name} added`);
      }
      onOpenChange(false);
    } catch (error) {
      setFormError(applyApiError(error, setError));
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={editing ? 'Edit account' : 'Add account'}
        description={
          editing ? undefined : 'Where your money lives: a bank account, cash, or a card.'
        }
      >
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
          <FormError message={formError} />
          <Field label="Name" error={errors.name?.message}>
            <Input autoFocus placeholder="Checking" {...register('name')} />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Type" error={errors.type?.message}>
              <Select
                {...register('type', {
                  onChange: (e) => {
                    setValue(
                      'icon',
                      DEFAULT_ICON[e.target.value as keyof typeof DEFAULT_ICON] ?? 'wallet',
                    );
                  },
                })}
              >
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {ACCOUNT_TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Currency"
              hint={editing ? 'Fixed once an account has history' : undefined}
              error={errors.currency?.message}
            >
              <Select disabled={editing} {...register('currency')}>
                {CURRENCY_CODES.map((c) => (
                  <option key={c} value={c}>
                    {c} · {CURRENCIES[c].name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field
            label={type === 'credit_card' ? 'Amount you owe today' : 'Balance today'}
            hint={
              type === 'credit_card'
                ? 'Enter debt as a negative number, for example -820.00, or 0 if it is paid off.'
                : editing
                  ? 'Correcting this adjusts the current balance by the same amount.'
                  : 'What the account holds right now. Later transactions build on this.'
            }
            error={errors.initialBalance?.message}
          >
            <ControlledMoneyInput
              control={control}
              name="initialBalance"
              currency={currency}
              allowNegative
              emptyValue={undefined}
            />
          </Field>
          <Field label="Bank or institution (optional)" error={errors.institution?.message}>
            <Input {...register('institution')} />
          </Field>
          <fieldset>
            <legend className="mb-1.5 text-[0.8125rem] font-medium">Colour</legend>
            <div className="flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Colour ${c}`}
                  aria-pressed={color === c}
                  onClick={() => setValue('color', c)}
                  className={cn(
                    'size-8 rounded-full border-2 border-transparent',
                    color === c && 'border-ink outline outline-2 outline-offset-2 outline-accent',
                  )}
                  style={{ background: c }}
                />
              ))}
            </div>
          </fieldset>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting}>
              {editing ? 'Save changes' : 'Add account'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
