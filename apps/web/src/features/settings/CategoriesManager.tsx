import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Archive, ArchiveRestore, Ellipsis, Pencil, Plus, Trash2 } from 'lucide-react';
import type { z } from 'zod';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  IconButton,
  Input,
  SegmentedControl,
  Select,
  Skeleton,
  cn,
  toast,
} from '@pfm/ui';
import { createCategorySchema, type CategoryDto } from '@pfm/validation';
import { CategoryDot, CategoryOptions } from '../../components/LedgerBits';
import { ApiError } from '../../lib/api';
import { applyApiError } from '../../lib/forms';
import {
  NO_CATEGORIES,
  useCategories,
  useCreateCategory,
  useDeleteCategory,
  useUpdateCategory,
} from '../../lib/ledger';
import { FormError } from '../../pages/auth/AuthLayout';

const KINDS = [
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
] as const;

const errorText = (error: unknown) =>
  error instanceof ApiError
    ? error.message
    : "Couldn't complete that. Check your connection and try again.";

type FormValues = z.input<typeof createCategorySchema>;

function CategoryDialog({
  open,
  onOpenChange,
  category,
  categories,
  initialType,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when renaming. */
  category: CategoryDto | null;
  categories: CategoryDto[];
  initialType: 'income' | 'expense';
}) {
  const create = useCreateCategory();
  const update = useUpdateCategory();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues, unknown, z.output<typeof createCategorySchema>>({
    resolver: zodResolver(createCategorySchema),
    defaultValues: {
      name: category?.name ?? '',
      type: category?.type ?? initialType,
      parentId: category?.parentId ?? null,
    },
  });
  const type = watch('type');
  const parentId = watch('parentId');

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      if (category) {
        await update.mutateAsync({ id: category.id, name: values.name });
        toast.success('Category renamed');
      } else {
        await create.mutateAsync(values);
        toast.success(`${values.name} added`);
      }
      onOpenChange(false);
    } catch (error) {
      setFormError(applyApiError(error, setError));
    }
  });

  const parents = categories.filter((c) => !c.parentId && !c.isArchived && c.type === type);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={category ? 'Rename category' : 'Add category'}>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
          <FormError message={formError} />
          <Field label="Name" error={errors.name?.message}>
            <Input autoFocus placeholder="Pet care" {...register('name')} />
          </Field>
          {!category ? (
            <>
              <SegmentedControl
                label="Kind"
                options={KINDS}
                value={type}
                onChange={(v) => {
                  setValue('type', v);
                  setValue('parentId', null);
                }}
                className="self-start"
              />
              <Field
                label="Part of (optional)"
                hint="Nest it under a bigger category, such as Food."
                error={errors.parentId?.message}
              >
                <Select
                  value={parentId ?? ''}
                  onChange={(e) => setValue('parentId', e.target.value || null)}
                >
                  <option value="">Top-level category</option>
                  {parents.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting}>
              {category ? 'Save name' : 'Add category'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({
  category,
  categories,
  onClose,
}: {
  category: CategoryDto | null;
  categories: CategoryDto[];
  onClose: () => void;
}) {
  const remove = useDeleteCategory();
  const [needsTarget, setNeedsTarget] = useState<string | null>(null);
  const [target, setTarget] = useState('');

  async function run() {
    if (!category) return;
    try {
      await remove.mutateAsync({ id: category.id, ...(target ? { reassignTo: target } : {}) });
      toast.success(`${category.name} deleted`);
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'has_transactions') {
        setNeedsTarget(error.message);
      } else {
        toast.error(errorText(error));
        onClose();
      }
    }
  }

  return (
    <Dialog
      open={category !== null}
      onOpenChange={(open) => !open && (setNeedsTarget(null), setTarget(''), onClose())}
    >
      {category ? (
        <DialogContent
          title={`Delete ${category.name}?`}
          description={
            needsTarget ??
            "This can't be undone. If you want to keep your history tidy, archive it instead."
          }
        >
          {needsTarget ? (
            <Field label="Move those transactions to">
              <Select value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">Choose a category…</option>
                <CategoryOptions
                  categories={categories.filter((c) => c.id !== category.id)}
                  type={category.type}
                />
              </Select>
            </Field>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Keep it
            </Button>
            <Button
              variant="danger"
              disabled={Boolean(needsTarget) && !target}
              loading={remove.isPending}
              onClick={() => void run()}
            >
              {needsTarget ? 'Move and delete' : 'Delete category'}
            </Button>
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

export function CategoriesManager() {
  const query = useCategories();
  const update = useUpdateCategory();
  const categories = query.data?.categories ?? NO_CATEGORIES;
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<CategoryDto | 'new' | null>(null);
  const [deleting, setDeleting] = useState<CategoryDto | null>(null);

  const tree = useMemo(() => {
    const ofKind = categories.filter((c) => c.type === kind && (showArchived || !c.isArchived));
    return ofKind
      .filter((c) => !c.parentId)
      .map((parent) => ({ parent, children: ofKind.filter((c) => c.parentId === parent.id) }));
  }, [categories, kind, showArchived]);
  const archivedCount = categories.filter((c) => c.type === kind && c.isArchived).length;

  async function toggleArchive(c: CategoryDto) {
    try {
      await update.mutateAsync({ id: c.id, isArchived: !c.isArchived });
      toast.success(c.isArchived ? `${c.name} restored` : `${c.name} archived`);
    } catch (error) {
      toast.error(errorText(error));
    }
  }

  const menu = (c: CategoryDto) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label={`Actions for ${c.name}`} size="icon-sm">
          <Ellipsis />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => setEditing(c)}>
          <Pencil aria-hidden /> Rename
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void toggleArchive(c)}>
          {c.isArchived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
          {c.isArchived ? 'Restore' : 'Archive'}
        </DropdownMenuItem>
        <DropdownMenuItem destructive onSelect={() => setDeleting(c)}>
          <Trash2 aria-hidden /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const row = (c: CategoryDto, nested = false) => (
    <li
      key={c.id}
      className={cn('flex items-center gap-3 border-b border-rule py-2', nested && 'pl-7')}
    >
      <CategoryDot color={c.color} />
      <span className={cn('min-w-0 flex-1 truncate', c.isArchived && 'text-muted line-through')}>
        {c.name}
      </span>
      {c.isArchived ? <Badge>Archived</Badge> : null}
      {menu(c)}
    </li>
  );

  return (
    <div className="max-w-xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl label="Category kind" options={KINDS} value={kind} onChange={setKind} />
        <Button variant="secondary" size="sm" onClick={() => setEditing('new')}>
          <Plus aria-hidden /> Add category
        </Button>
      </div>

      {query.isPending ? (
        <div className="mt-4 space-y-2" role="status" aria-label="Loading categories">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : query.isError ? (
        <EmptyState
          title="Couldn't load your categories"
          description="Check your connection and try again."
          action={<Button onClick={() => void query.refetch()}>Try again</Button>}
        />
      ) : tree.length === 0 ? (
        <p className="mt-4 text-muted">No {kind} categories yet.</p>
      ) : (
        <ul className="mt-2 border-t border-rule">
          {tree.map(({ parent, children }) => (
            <li key={parent.id} className="list-none">
              <ul>
                {row(parent)}
                {children.map((child) => row(child, true))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {archivedCount > 0 ? (
        <button
          type="button"
          className="mt-3 text-[0.875rem] font-medium text-accent underline-offset-4 hover:underline"
          aria-expanded={showArchived}
          onClick={() => setShowArchived((s) => !s)}
        >
          {showArchived ? 'Hide' : 'Show'} {archivedCount} archived
        </button>
      ) : null}

      <CategoryDialog
        key={editing === 'new' ? 'new' : (editing?.id ?? 'closed')}
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        category={editing && editing !== 'new' ? editing : null}
        categories={categories}
        initialType={kind}
      />
      <DeleteDialog category={deleting} categories={categories} onClose={() => setDeleting(null)} />
    </div>
  );
}
