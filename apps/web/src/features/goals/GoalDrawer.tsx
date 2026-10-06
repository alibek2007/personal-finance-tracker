import { useState } from 'react';
import { Archive, ArchiveRestore, Pencil, Trash2, X } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import {
  Button,
  Dialog,
  DialogContent,
  DrawerContent,
  Field,
  GoalProgress,
  Input,
  SegmentedControl,
  Skeleton,
  toast,
} from '@pfm/ui';
import { money } from '@pfm/finance';
import type { GoalDto } from '@pfm/validation';
import { AmountText, useToday } from '../../components/LedgerBits';
import { ControlledMoneyInput } from '../../components/ControlledMoneyInput';
import { ApiError } from '../../lib/api';
import { applyApiError } from '../../lib/forms';
import {
  useAddContribution,
  useDeleteGoal,
  useGoal,
  useRemoveContribution,
  useUpdateGoal,
} from '../../lib/goals';
import { FormError } from '../../pages/auth/AuthLayout';
import { useForm } from 'react-hook-form';
import { GoalDialog } from './GoalDialog';

const errorText = (error: unknown) =>
  error instanceof ApiError
    ? error.message
    : "Couldn't complete that. Check your connection and try again.";

const KINDS = [
  { value: 'deposit', label: 'Add money' },
  { value: 'withdraw', label: 'Take out' },
] as const;

interface ContributionForm {
  amount: number | undefined;
  date: string;
  note: string;
}

function AddMoney({ goal }: { goal: GoalDto }) {
  const today = useToday();
  const add = useAddContribution(goal.id);
  const [kind, setKind] = useState<'deposit' | 'withdraw'>('deposit');
  const [formError, setFormError] = useState<string | null>(null);
  const {
    control,
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ContributionForm>({ defaultValues: { amount: undefined, date: today, note: '' } });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    if (!values.amount || values.amount <= 0) {
      setError('amount', { message: 'Enter an amount greater than zero' });
      return;
    }
    try {
      await add.mutateAsync({
        amount: kind === 'deposit' ? values.amount : -values.amount,
        date: values.date || today,
        note: values.note.trim() || null,
      });
      toast.success(kind === 'deposit' ? 'Added to your goal' : 'Taken out of your goal');
      reset({ amount: undefined, date: today, note: '' });
    } catch (error) {
      setFormError(applyApiError(error, setError));
    }
  });

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-4 border-y border-rule py-5"
      aria-label="Add or take out money"
    >
      <SegmentedControl
        label="Action"
        options={KINDS}
        value={kind}
        onChange={setKind}
        className="self-start"
      />
      <FormError message={formError} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Amount" error={errors.amount?.message}>
          <ControlledMoneyInput
            control={control}
            name="amount"
            currency={goal.currency}
            emptyValue={undefined}
          />
        </Field>
        <Field label="Date" error={errors.date?.message}>
          <Input type="date" max={today} {...register('date')} />
        </Field>
      </div>
      <Field label="Note (optional)">
        <Input placeholder="Bonus, birthday money…" {...register('note')} />
      </Field>
      <Button type="submit" loading={isSubmitting} className="self-start">
        {kind === 'deposit' ? 'Add to goal' : 'Take out'}
      </Button>
    </form>
  );
}

export function GoalDrawer({ goal, onClose }: { goal: GoalDto | null; onClose: () => void }) {
  const detail = useGoal(goal?.id ?? null);
  const update = useUpdateGoal(goal?.id ?? '');
  const remove = useDeleteGoal();
  const removeContribution = useRemoveContribution(goal?.id ?? '');
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function toggleArchive() {
    if (!goal) return;
    try {
      await update.mutateAsync({ isArchived: !goal.isArchived });
      toast.success(goal.isArchived ? `${goal.name} restored` : `${goal.name} archived`);
      onClose();
    } catch (error) {
      toast.error(errorText(error));
    }
  }

  async function doDelete() {
    if (!goal) return;
    setConfirmDelete(false);
    try {
      await remove.mutateAsync(goal.id);
      toast.success('Goal deleted');
      onClose();
    } catch (error) {
      toast.error(errorText(error));
    }
  }

  async function undo(contributionId: string) {
    try {
      await removeContribution.mutateAsync(contributionId);
      toast.success('Entry removed');
    } catch (error) {
      toast.error(errorText(error));
    }
  }

  return (
    <>
      <Dialog open={goal !== null} onOpenChange={(open) => !open && onClose()}>
        {goal ? (
          <DrawerContent
            title={goal.name}
            description={
              goal.deadline
                ? `Target date ${format(parseISO(goal.deadline), 'MMMM d, yyyy')}`
                : 'No target date'
            }
          >
            <GoalProgress
              name={goal.name}
              current={money(Math.max(0, goal.currentAmount), goal.currency)}
              target={money(goal.targetAmount, goal.currency)}
              status={goal.status}
              headline={goal.headline}
              note={goal.detail}
            />

            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                <Pencil aria-hidden /> Edit
              </Button>
              <Button
                variant="secondary"
                size="sm"
                loading={update.isPending}
                onClick={() => void toggleArchive()}
              >
                {goal.isArchived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
                {goal.isArchived ? 'Restore' : 'Archive'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
                <Trash2 aria-hidden /> Delete
              </Button>
            </div>

            {goal.isArchived ? (
              <p className="text-muted">
                This goal is archived. Restore it to add or take out money.
              </p>
            ) : (
              <AddMoney goal={goal} />
            )}

            <section aria-label="History">
              <h3 className="font-display text-lg">History</h3>
              {detail.isPending ? (
                <div className="mt-3 space-y-2" role="status" aria-label="Loading history">
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-full" />
                </div>
              ) : detail.isError ? (
                <p className="mt-3 text-muted">
                  Couldn't load the history. Close and reopen to try again.
                </p>
              ) : detail.data.contributions.length === 0 ? (
                <p className="mt-3 text-muted">Nothing added yet.</p>
              ) : (
                <ul className="mt-2">
                  {detail.data.contributions.map((c) => (
                    <li key={c.id} className="flex items-center gap-3 border-b border-rule py-2.5">
                      <span className="w-16 shrink-0 text-[0.8125rem] text-muted">
                        {format(parseISO(c.date), 'MMM d, yy')}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[0.9375rem]">
                        {c.note ?? (c.amount > 0 ? 'Added' : 'Taken out')}
                      </span>
                      <span className="font-medium">
                        <AmountText minor={c.amount} currency={goal.currency} kind="delta" />
                      </span>
                      <button
                        type="button"
                        aria-label={`Remove the ${c.amount > 0 ? 'deposit' : 'withdrawal'} on ${format(parseISO(c.date), 'MMM d')}`}
                        onClick={() => void undo(c.id)}
                        className="rounded-sm p-1 text-muted hover:bg-sunk hover:text-ink"
                      >
                        <X aria-hidden className="size-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </DrawerContent>
        ) : null}
      </Dialog>

      <GoalDialog
        key={editing ? `edit-${goal?.id}` : 'edit-closed'}
        open={editing}
        goal={goal}
        onOpenChange={setEditing}
      />

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent
          title={`Delete ${goal?.name ?? 'goal'}?`}
          description="The goal and its history will be removed. If you just want it out of the way, archive it instead."
        >
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Keep it
            </Button>
            <Button variant="danger" onClick={() => void doDelete()}>
              Delete goal
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
