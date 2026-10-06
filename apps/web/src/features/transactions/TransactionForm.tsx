import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link } from 'react-router-dom';
import { Button, Field, Input, SegmentedControl, Select, Textarea, cn } from '@pfm/ui';
import { CURRENCIES, type CurrencyCode } from '@pfm/finance';
import {
  createTransactionSchema,
  type AccountDto,
  type CategoryDto,
  type CreateTransactionInput,
  type SuggestionsDto,
  type TransactionDto,
} from '@pfm/validation';
import { ControlledMoneyInput } from '../../components/ControlledMoneyInput';
import { CategoryOptions } from '../../components/LedgerBits';
import { ApiError } from '../../lib/api';
import { FormError } from '../../pages/auth/AuthLayout';

const TYPES = [
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
  { value: 'transfer', label: 'Move money' },
] as const;

/** Same rules as the API (shared schema), with friendlier messages for the amount fields. */
const formSchema = createTransactionSchema.extend({
  amount: z
    .number({ error: 'Enter an amount greater than zero' })
    .int()
    .positive('Enter an amount greater than zero'),
  transferAmount: z.number().int().positive().nullish(),
});
type FormValues = z.input<typeof formSchema>;

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const LAST_ACCOUNT_KEY = 'pfm.lastAccount';
function rememberedAccount(): string | null {
  try {
    return localStorage.getItem(LAST_ACCOUNT_KEY);
  } catch {
    return null;
  }
}
function rememberAccount(id: string) {
  try {
    localStorage.setItem(LAST_ACCOUNT_KEY, id);
  } catch {
    /* preference only */
  }
}

export interface TransactionFormProps {
  accounts: AccountDto[];
  categories: CategoryDto[];
  suggestions?: SuggestionsDto['suggestions'] | undefined;
  /** Editing: the existing transaction. Creating: omit (or pass a template to prefill, e.g. duplicate). */
  initial?: TransactionDto | undefined;
  mode: 'create' | 'edit';
  submitLabel?: string;
  onSubmit: (values: CreateTransactionInput, options: { another: boolean }) => Promise<void>;
  onCancel: () => void;
}

export function TransactionForm({
  accounts,
  categories,
  suggestions,
  initial,
  mode,
  submitLabel,
  onSubmit,
  onCancel,
}: TransactionFormProps) {
  const active = accounts.filter(
    (a) => !a.isArchived || a.id === initial?.accountId || a.id === initial?.transferAccountId,
  );
  const defaultAccount = useMemo(() => {
    const remembered = rememberedAccount();
    return (
      active.find((a) => a.id === remembered && !a.isArchived)?.id ??
      active.find((a) => !a.isArchived)?.id ??
      ''
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [formError, setFormError] = useState<string | null>(null);
  const {
    control,
    register,
    handleSubmit,
    setError,
    setValue,
    watch,
    reset,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<FormValues, unknown, CreateTransactionInput>({
    resolver: zodResolver(formSchema),
    defaultValues: initial
      ? {
          type: initial.type,
          accountId: initial.accountId,
          categoryId: initial.categoryId,
          amount: initial.amount,
          description: initial.description,
          merchant: initial.merchant,
          date: initial.date,
          notes: initial.notes,
          transferAccountId: initial.transferAccountId,
          transferAmount: initial.transferAmount,
          isRefund: initial.isRefund,
        }
      : {
          type: 'expense',
          accountId: defaultAccount,
          categoryId: null,
          date: today(),
          description: '',
          merchant: '',
          notes: '',
          transferAccountId: null,
          transferAmount: null,
          isRefund: false,
        },
  });

  const type = watch('type');
  const accountId = watch('accountId');
  const transferAccountId = watch('transferAccountId');
  const categoryId = watch('categoryId');
  const account = accounts.find((a) => a.id === accountId);
  const destination = accounts.find((a) => a.id === transferAccountId);
  const crossCurrency =
    type === 'transfer' && account && destination && account.currency !== destination.currency;
  const currency: CurrencyCode = account?.currency ?? 'USD';

  // Moving between types clears the fields that no longer apply.
  useEffect(() => {
    if (type === 'transfer') setValue('categoryId', null);
    else setValue('transferAccountId', null);
  }, [type, setValue]);

  const submit = (another: boolean) =>
    handleSubmit(async (values) => {
      setFormError(null);
      const payload: CreateTransactionInput = {
        ...values,
        merchant: values.merchant?.trim() ? values.merchant.trim() : null,
        notes: values.notes?.trim() ? values.notes.trim() : null,
        categoryId: values.type === 'transfer' ? null : (values.categoryId ?? null),
        transferAccountId: values.type === 'transfer' ? values.transferAccountId : null,
        transferAmount: crossCurrency
          ? (values.transferAmount ?? null)
          : values.type === 'transfer'
            ? values.amount
            : null,
        isRefund: values.type === 'income' ? values.isRefund : false,
      };
      try {
        await onSubmit(payload, { another });
        rememberAccount(values.accountId);
        if (another) {
          reset({
            type: values.type,
            accountId: values.accountId,
            categoryId: values.categoryId,
            date: values.date,
            description: '',
            merchant: '',
            notes: '',
            transferAccountId: values.transferAccountId,
            transferAmount: null,
            isRefund: false,
          });
          setFocus('amount');
        }
      } catch (error) {
        if (error instanceof ApiError) {
          let mapped = 0;
          for (const [field, messages] of Object.entries(error.details ?? {})) {
            setError(field as keyof FormValues, {
              type: 'server',
              message: messages[0] ?? error.message,
            });
            mapped += 1;
          }
          setFormError(mapped > 0 ? null : error.message);
        } else {
          setFormError("Couldn't save this transaction. Check your connection and try again.");
        }
      }
    });

  function applySuggestion(s: SuggestionsDto['suggestions'][number]) {
    setValue('type', s.type);
    setValue('accountId', s.accountId);
    setValue('categoryId', s.categoryId);
    setValue('description', s.description);
    setValue('merchant', s.merchant ?? '');
    setFocus('amount');
  }

  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const visibleSuggestions = (suggestions ?? [])
    .filter((s) => accountById.get(s.accountId) && !accountById.get(s.accountId)!.isArchived)
    .slice(0, 4);

  return (
    <form onSubmit={submit(false)} noValidate className="flex flex-col gap-6">
      <FormError message={formError} />

      <Controller
        control={control}
        name="type"
        render={({ field }) => (
          <SegmentedControl
            label="Transaction type"
            options={TYPES}
            value={field.value ?? 'expense'}
            onChange={field.onChange}
            className="self-start"
          />
        )}
      />

      {mode === 'create' && visibleSuggestions.length > 0 ? (
        <div>
          <p className="mb-2 text-[0.8125rem] text-muted">Repeat a recent one</p>
          <ul className="flex flex-wrap gap-2">
            {visibleSuggestions.map((s) => (
              <li key={`${s.type}-${s.accountId}-${s.categoryId}-${s.description}`}>
                <button
                  type="button"
                  onClick={() => applySuggestion(s)}
                  className="rounded-full border border-rule-strong bg-surface px-3 py-1.5 text-[0.8125rem] transition-colors hover:bg-sunk"
                >
                  {s.description}
                  <span className="text-muted">
                    {' · '}
                    {s.categoryId ? categoryById.get(s.categoryId)?.name : 'No category'}
                    {' · '}
                    {accountById.get(s.accountId)?.name}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label={type === 'transfer' ? 'Amount leaving' : 'Amount'}
          error={errors.amount?.message}
        >
          <ControlledMoneyInput
            control={control}
            name="amount"
            currency={currency}
            emptyValue={undefined}
            autoFocus
          />
        </Field>

        <Field label="Date" error={errors.date?.message}>
          <Input type="date" {...register('date')} />
        </Field>

        <Field
          label={type === 'transfer' ? 'From account' : 'Account'}
          error={errors.accountId?.message}
        >
          <Select {...register('accountId')}>
            {active.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {CURRENCIES[a.currency].symbol}
                {a.isArchived ? ' (archived)' : ''}
              </option>
            ))}
          </Select>
        </Field>

        {type === 'transfer' ? (
          <Field label="To account" error={errors.transferAccountId?.message}>
            <Select
              value={transferAccountId ?? ''}
              onChange={(e) =>
                setValue('transferAccountId', e.target.value || null, { shouldValidate: true })
              }
            >
              <option value="">Choose an account…</option>
              {active
                .filter((a) => a.id !== accountId)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {CURRENCIES[a.currency].symbol}
                  </option>
                ))}
            </Select>
          </Field>
        ) : (
          <Field label="Category" error={errors.categoryId?.message}>
            <Select
              value={categoryId ?? ''}
              onChange={(e) =>
                setValue('categoryId', e.target.value || null, { shouldValidate: true })
              }
            >
              <option value="">No category</option>
              <CategoryOptions
                categories={categories}
                type={
                  type === 'income' && watch('isRefund')
                    ? 'expense'
                    : type === 'income'
                      ? 'income'
                      : 'expense'
                }
                includeArchivedId={initial?.categoryId}
              />
            </Select>
          </Field>
        )}

        {crossCurrency && destination ? (
          <Field
            label={`Amount arriving (${destination.currency})`}
            hint={`${account!.currency} and ${destination.currency} are different currencies, so enter what arrives.`}
            error={errors.transferAmount?.message}
            className="sm:col-span-2"
          >
            <ControlledMoneyInput
              control={control}
              name="transferAmount"
              currency={destination.currency}
            />
          </Field>
        ) : null}

        <Field label="Description" error={errors.description?.message} className="sm:col-span-2">
          <Input
            autoComplete="off"
            placeholder={
              type === 'transfer'
                ? 'Monthly savings'
                : type === 'income'
                  ? 'Salary'
                  : 'Lunch with Sam'
            }
            {...register('description')}
          />
        </Field>

        {type === 'income' ? (
          <label className="flex items-center gap-2 text-[0.9375rem] sm:col-span-2">
            <input
              type="checkbox"
              className="size-4 accent-[var(--accent)]"
              {...register('isRefund')}
            />
            This is a refund of an earlier purchase
          </label>
        ) : null}
      </div>

      <details
        className="group rounded-md border border-rule px-4 py-3"
        open={Boolean(initial?.merchant || initial?.notes)}
      >
        <summary className="cursor-pointer text-[0.9375rem] font-medium">
          Merchant and notes
        </summary>
        <div className="mt-4 grid gap-5">
          <Field label="Merchant" error={errors.merchant?.message}>
            <Input autoComplete="off" {...register('merchant')} />
          </Field>
          <Field label="Notes" error={errors.notes?.message}>
            <Textarea {...register('notes')} />
          </Field>
        </div>
      </details>

      <div className={cn('flex flex-wrap items-center gap-3')}>
        <Button type="submit" size="lg" loading={isSubmitting}>
          {submitLabel ??
            (mode === 'edit'
              ? 'Save changes'
              : type === 'income'
                ? 'Save income'
                : type === 'transfer'
                  ? 'Move money'
                  : 'Save expense')}
        </Button>
        {mode === 'create' ? (
          <Button
            type="button"
            size="lg"
            variant="secondary"
            disabled={isSubmitting}
            onClick={() => void submit(true)()}
          >
            Save and add another
          </Button>
        ) : null}
        <Button type="button" size="lg" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function NoAccountsNotice() {
  return (
    <div className="border-t border-rule py-10">
      <h2 className="font-display text-xl">Add an account first</h2>
      <p className="mt-2 max-w-md text-muted">
        Transactions live inside an account such as Checking or Cash. It takes a few seconds to add
        one.
      </p>
      <Link
        to="/accounts?new=1"
        className="mt-4 inline-flex h-10 items-center rounded-md bg-accent px-4 font-medium text-accent-ink hover:bg-accent-hover"
      >
        Add your first account
      </Link>
    </div>
  );
}
