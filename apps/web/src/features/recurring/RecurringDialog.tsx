import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button, Dialog, DialogContent, Field, Input, Select, toast } from '@pfm/ui';
import {
  createRecurringSchema,
  idSchema,
  isoDateSchema,
  type CreateRecurringInput,
  type RecurringDto,
} from '@pfm/validation';
import { ControlledMoneyInput } from '../../components/ControlledMoneyInput';
import { CategoryOptions, useToday } from '../../components/LedgerBits';
import { applyApiError } from '../../lib/forms';
import { NO_CATEGORIES, useAccounts, useCategories } from '../../lib/ledger';
import { useCreateRecurring, useUpdateRecurring } from '../../lib/recurring';
import { FormError } from '../../pages/auth/AuthLayout';

/** An untouched optional date input holds '' (no end date), which is valid; the API receives null. */
const formSchema = createRecurringSchema.extend({
  endDate: z.union([z.literal(''), isoDateSchema]).nullish(),
  categoryId: z.union([z.literal(''), idSchema]).nullish(),
  // An untouched date input is '': say what is missing rather than quoting a date format.
  nextOccurrence: z.string().min(1, 'Choose the date of the first payment').pipe(isoDateSchema),
});
type FormValues = z.input<typeof formSchema>;

const FREQUENCY_LABELS = {
  daily: ['day', 'days'],
  weekly: ['week', 'weeks'],
  monthly: ['month', 'months'],
  yearly: ['year', 'years'],
} as const;

export function RecurringDialog({
  open,
  onOpenChange,
  rule,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when editing. */
  rule: RecurringDto | null;
}) {
  const today = useToday();
  const accountsQuery = useAccounts();
  const categories = useCategories().data?.categories ?? NO_CATEGORIES;
  const create = useCreateRecurring();
  const update = useUpdateRecurring(rule?.id ?? '');
  const [formError, setFormError] = useState<string | null>(null);
  const editing = rule !== null;
  const accounts = (accountsQuery.data?.accounts ?? []).filter(
    (a) => !a.isArchived || a.id === rule?.accountId,
  );

  const {
    control,
    register,
    handleSubmit,
    setError,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues, unknown, z.output<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: rule
      ? {
          type: rule.type,
          description: rule.description,
          amount: rule.amount,
          accountId: rule.accountId,
          categoryId: rule.categoryId ?? '',
          frequency: rule.frequency,
          interval: rule.interval,
          nextOccurrence: rule.nextOccurrence,
          endDate: rule.endDate ?? '',
        }
      : {
          type: 'expense',
          description: '',
          accountId: '',
          categoryId: '',
          frequency: 'monthly',
          interval: 1,
          nextOccurrence: '',
          endDate: '',
        },
  });
  const type = watch('type');
  const frequency = watch('frequency');
  const interval = watch('interval');
  const accountId = watch('accountId');
  const categoryId = watch('categoryId') ?? '';
  const account = accounts.find((a) => a.id === accountId);
  const [one, many] = FREQUENCY_LABELS[frequency];

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const endDate = values.endDate ? values.endDate : null;
    const categoryIdOrNull = values.categoryId ? values.categoryId : null;
    try {
      if (rule) {
        await update.mutateAsync({
          description: values.description,
          amount: values.amount,
          accountId: values.accountId,
          categoryId: categoryIdOrNull,
          frequency: values.frequency,
          interval: values.interval,
          nextOccurrence: values.nextOccurrence,
          endDate,
        });
        toast.success('Recurring payment updated');
      } else {
        await create.mutateAsync({
          ...values,
          categoryId: categoryIdOrNull,
          endDate,
        } as CreateRecurringInput);
        toast.success(`${values.description} added`);
      }
      onOpenChange(false);
    } catch (error) {
      setFormError(applyApiError(error, setError));
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={editing ? 'Edit recurring payment' : 'Add a recurring payment'}
        description={
          editing
            ? 'Changes apply to future payments. Payments already recorded stay as they are.'
            : 'A bill, subscription or paycheck. Ledger records it on the day it is due.'
        }
      >
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
          <FormError message={formError} />
          <fieldset className="flex gap-2" disabled={editing} aria-label="Money in or out">
            {(['expense', 'income'] as const).map((t) => (
              <Button
                key={t}
                type="button"
                variant={type === t ? 'primary' : 'secondary'}
                size="sm"
                aria-pressed={type === t}
                onClick={() => {
                  setValue('type', t);
                  setValue('categoryId', '');
                }}
              >
                {t === 'expense' ? 'Money out' : 'Money in'}
              </Button>
            ))}
          </fieldset>
          <Field label="Name" error={errors.description?.message}>
            <Input
              autoFocus
              placeholder={type === 'expense' ? 'Netflix' : 'Salary'}
              {...register('description')}
            />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Amount" error={errors.amount?.message}>
              <ControlledMoneyInput
                control={control}
                name="amount"
                currency={rule?.currency ?? account?.currency ?? 'USD'}
                emptyValue={undefined}
              />
            </Field>
            <Field label="Account" error={errors.accountId?.message}>
              <Select
                value={accountId}
                onChange={(e) => setValue('accountId', e.target.value, { shouldValidate: true })}
              >
                <option value="">Choose an account…</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Category (optional)" error={errors.categoryId?.message}>
            <Select
              value={categoryId}
              onChange={(e) => setValue('categoryId', e.target.value, { shouldValidate: true })}
            >
              <option value="">No category</option>
              <CategoryOptions
                categories={categories}
                type={type}
                includeArchivedId={rule?.categoryId}
              />
            </Select>
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Repeats" error={errors.frequency?.message}>
              <Select {...register('frequency')}>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
                <option value="daily">Daily</option>
              </Select>
            </Field>
            <Field
              label="Every"
              hint={`Every ${interval === 1 ? one : `${interval || 'N'} ${many}`}`}
              error={errors.interval?.message}
            >
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={60}
                {...register('interval', { valueAsNumber: true })}
              />
            </Field>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label={editing ? 'Next payment' : 'First payment'}
              hint="Today or later. Later payments keep this day of the month."
              error={errors.nextOccurrence?.message}
            >
              <Input type="date" min={today} {...register('nextOccurrence')} />
            </Field>
            <Field
              label="Ends (optional)"
              hint="Leave empty to keep going until you stop it."
              error={errors.endDate?.message}
            >
              <Input type="date" min={today} {...register('endDate')} />
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting}>
              {editing ? 'Save changes' : 'Add payment'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
