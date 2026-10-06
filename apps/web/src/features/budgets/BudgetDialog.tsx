import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { Button, Dialog, DialogContent, Field, Input, Select, toast } from '@pfm/ui';
import { formatMoney, money } from '@pfm/finance';
import { createBudgetSchema, type BudgetDto, type CreateBudgetInput } from '@pfm/validation';
import { ControlledMoneyInput } from '../../components/ControlledMoneyInput';
import { CategoryOptions } from '../../components/LedgerBits';
import { ApiError } from '../../lib/api';
import { useCurrentUser } from '../../lib/auth';
import { useCategoryBreakdown } from '../../lib/analytics';
import { applyApiError } from '../../lib/forms';
import { useCreateBudget, useDeleteBudget, useUpdateBudget } from '../../lib/budgets';
import { NO_CATEGORIES, useCategories } from '../../lib/ledger';
import { FormError } from '../../pages/auth/AuthLayout';

const PERIODS = [
  { value: 'monthly', label: 'Every month' },
  { value: 'weekly', label: 'Every week (Mon to Sun)' },
  { value: 'yearly', label: 'Every year' },
] as const;

type FormValues = z.input<typeof createBudgetSchema>;

export function BudgetDialog({
  open,
  onOpenChange,
  budget,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when editing. */
  budget: BudgetDto | null;
}) {
  const user = useCurrentUser();
  const categoriesQuery = useCategories();
  const categories = categoriesQuery.data?.categories ?? NO_CATEGORIES;
  const create = useCreateBudget();
  const update = useUpdateBudget(budget?.id ?? '');
  const remove = useDeleteBudget();
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const editing = budget !== null;

  const {
    control,
    register,
    handleSubmit,
    setError,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues, unknown, CreateBudgetInput>({
    resolver: zodResolver(createBudgetSchema),
    defaultValues: budget
      ? {
          categoryId: budget.categoryId,
          amount: budget.amount,
          period: budget.period,
          alertThreshold: budget.alertThreshold,
        }
      : { categoryId: '', period: 'monthly', alertThreshold: 80 },
  });
  const categoryId = watch('categoryId');
  const period = watch('period');

  // What you actually spent recently is the best starting point for a limit.
  const recent = useCategoryBreakdown({ range: '3m' }, categoryId !== '');
  const averageHint = useMemo(() => {
    if (!recent.data || !categoryId) return null;
    const top = recent.data.slices.find((s) => s.categoryId === categoryId);
    const child = recent.data.slices
      .flatMap((s) => s.children)
      .find((c) => c.categoryId === categoryId);
    const total = top?.amount ?? child?.amount;
    if (!total) return null;
    const perMonth = Math.round(total / 3);
    const perPeriod =
      period === 'weekly' ? Math.round(total / 13) : period === 'yearly' ? total * 4 : perMonth;
    return formatMoney(money(perPeriod, recent.data.currency), {
      locale: user.locale,
      compactFraction: true,
    });
  }, [recent.data, categoryId, period, user.locale]);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      if (budget) {
        await update.mutateAsync({
          amount: values.amount,
          period: values.period,
          alertThreshold: values.alertThreshold,
        });
        toast.success('Budget updated');
      } else {
        await create.mutateAsync(values);
        toast.success('Budget set');
      }
      onOpenChange(false);
    } catch (error) {
      setFormError(applyApiError(error, setError));
    }
  });

  async function doDelete() {
    if (!budget) return;
    try {
      await remove.mutateAsync(budget.id);
      toast.success(`${budget.categoryName} budget removed`);
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "Couldn't remove that budget. Try again.",
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={editing ? `Edit ${budget.categoryName} budget` : 'Set a budget'}
        description={
          editing ? undefined : 'Choose a category and how much you want to spend on it.'
        }
      >
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
          <FormError message={formError} />
          <Field label="Category" error={errors.categoryId?.message}>
            <Select
              disabled={editing}
              value={categoryId}
              onChange={(e) => setValue('categoryId', e.target.value, { shouldValidate: true })}
            >
              <option value="">Choose a category…</option>
              <CategoryOptions
                categories={categories}
                type="expense"
                includeArchivedId={budget?.categoryId}
              />
            </Select>
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Repeats" error={errors.period?.message}>
              <Select {...register('period')}>
                {PERIODS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Limit"
              hint={
                averageHint
                  ? `You've averaged about ${averageHint} over the last 3 months.`
                  : undefined
              }
              error={errors.amount?.message}
            >
              <ControlledMoneyInput
                control={control}
                name="amount"
                currency={budget?.currency ?? user.currency}
                emptyValue={undefined}
              />
            </Field>
          </div>
          <Field
            label="Warn me at (percent used)"
            hint="You'll see this budget flagged once spending reaches this point."
            error={errors.alertThreshold?.message}
          >
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={100}
              className="max-w-28"
              {...register('alertThreshold', { valueAsNumber: true })}
            />
          </Field>
          <div className="flex items-center gap-2">
            {editing ? (
              confirmDelete ? (
                <>
                  <span className="text-[0.8125rem] text-muted">Remove this budget?</span>
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    loading={remove.isPending}
                    onClick={() => void doDelete()}
                  >
                    Yes, remove
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmDelete(false)}
                  >
                    Keep it
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmDelete(true)}
                >
                  Remove budget
                </Button>
              )
            ) : null}
            <div className="ml-auto flex gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={isSubmitting}>
                {editing ? 'Save changes' : 'Set budget'}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
