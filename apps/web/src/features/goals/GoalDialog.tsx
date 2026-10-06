import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button, Dialog, DialogContent, Field, Input, toast } from '@pfm/ui';
import {
  createGoalSchema,
  isoDateSchema,
  type CreateGoalInput,
  type GoalDto,
} from '@pfm/validation';
import { ControlledMoneyInput } from '../../components/ControlledMoneyInput';
import { useToday } from '../../components/LedgerBits';
import { useCurrentUser } from '../../lib/auth';
import { applyApiError } from '../../lib/forms';
import { useCreateGoal, useUpdateGoal } from '../../lib/goals';
import { FormError } from '../../pages/auth/AuthLayout';

/** An untouched optional date input holds '' (no date), which is valid; the API receives null. */
const formSchema = createGoalSchema.extend({
  deadline: z.union([z.literal(''), isoDateSchema]).nullish(),
});
type FormValues = z.input<typeof formSchema>;

export function GoalDialog({
  open,
  onOpenChange,
  goal,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when editing. */
  goal: GoalDto | null;
}) {
  const user = useCurrentUser();
  const today = useToday();
  const create = useCreateGoal();
  const update = useUpdateGoal(goal?.id ?? '');
  const [formError, setFormError] = useState<string | null>(null);
  const editing = goal !== null;

  const {
    control,
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues, unknown, z.output<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: goal
      ? {
          name: goal.name,
          targetAmount: goal.targetAmount,
          deadline: goal.deadline ?? '',
          color: goal.color,
          icon: goal.icon,
        }
      : { name: '', deadline: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const deadline = values.deadline ? values.deadline : null;
    try {
      if (goal) {
        await update.mutateAsync({
          name: values.name,
          targetAmount: values.targetAmount,
          deadline,
        });
        toast.success('Goal updated');
      } else {
        await create.mutateAsync({ ...values, deadline } as CreateGoalInput);
        toast.success(`${values.name} created`);
      }
      onOpenChange(false);
    } catch (error) {
      setFormError(applyApiError(error, setError));
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={editing ? 'Edit goal' : 'Create a goal'}
        description={
          editing
            ? undefined
            : 'Something you are saving up for. You can add to it whenever you set money aside.'
        }
      >
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
          <FormError message={formError} />
          <Field label="What are you saving for?" error={errors.name?.message}>
            <Input autoFocus placeholder="Emergency fund" {...register('name')} />
          </Field>
          <Field label="Target amount" error={errors.targetAmount?.message}>
            <ControlledMoneyInput
              control={control}
              name="targetAmount"
              currency={goal?.currency ?? user.currency}
              emptyValue={undefined}
            />
          </Field>
          <Field
            label="Deadline (optional)"
            hint="With a date, Ledger works out how much to save each month."
            error={errors.deadline?.message}
          >
            <Input type="date" min={today} {...register('deadline')} />
          </Field>
          {!editing ? (
            <Field
              label="Already saved (optional)"
              hint="Money you have already put aside for this."
              error={errors.startingAmount?.message}
            >
              <ControlledMoneyInput
                control={control}
                name="startingAmount"
                currency={user.currency}
                emptyValue={undefined}
              />
            </Field>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting}>
              {editing ? 'Save changes' : 'Create goal'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
