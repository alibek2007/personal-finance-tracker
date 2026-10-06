import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button, EmptyState, Skeleton, toast } from '@pfm/ui';
import type { CreateTransactionInput, TransactionDto } from '@pfm/validation';
import { ApiError } from '../../lib/api';
import {
  useAccounts,
  useCategories,
  useCreateTransaction,
  useSuggestions,
  useTransaction,
  useUpdateTransaction,
} from '../../lib/ledger';
import { NoAccountsNotice, TransactionForm } from './TransactionForm';

const savedMessage = (t: { type: string }) =>
  t.type === 'income' ? 'Income saved' : t.type === 'transfer' ? 'Money moved' : 'Expense saved';

function Loading() {
  return (
    <div role="status" aria-label="Loading form" className="max-w-2xl space-y-4">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  );
}

export function AddTransactionPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const duplicateId = params.get('duplicate') ?? undefined;
  const accounts = useAccounts();
  const categories = useCategories();
  const suggestions = useSuggestions();
  const source = useTransaction(duplicateId);
  const create = useCreateTransaction();

  const loading = accounts.isPending || categories.isPending || (duplicateId && source.isPending);
  const failed = accounts.isError || categories.isError;

  async function submit(values: CreateTransactionInput, { another }: { another: boolean }) {
    const saved = await create.mutateAsync(values);
    toast.success(savedMessage(saved));
    if (!another) navigate('/transactions');
  }

  // A duplicate keeps everything except the date, which becomes today.
  const prefill: TransactionDto | undefined = source.data
    ? { ...source.data, date: new Date().toLocaleDateString('en-CA') }
    : undefined;

  return (
    <div>
      <h1 className="font-display text-4xl">
        {duplicateId ? 'Duplicate transaction' : 'Add transaction'}
      </h1>
      <div className="mt-8 max-w-2xl">
        {loading ? (
          <Loading />
        ) : failed ? (
          <EmptyState
            title="Couldn't load the form"
            description="Check your connection and try again."
            action={
              <Button
                onClick={() => {
                  void accounts.refetch();
                  void categories.refetch();
                }}
              >
                Try again
              </Button>
            }
          />
        ) : accounts.data!.accounts.filter((a) => !a.isArchived).length === 0 ? (
          <NoAccountsNotice />
        ) : (
          <TransactionForm
            key={duplicateId ?? 'new'}
            mode="create"
            accounts={accounts.data!.accounts}
            categories={categories.data!.categories}
            suggestions={suggestions.data?.suggestions}
            initial={prefill}
            onSubmit={submit}
            onCancel={() => navigate(-1)}
          />
        )}
      </div>
    </div>
  );
}

export function EditTransactionPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const accounts = useAccounts();
  const categories = useCategories();
  const transaction = useTransaction(id);
  const update = useUpdateTransaction(id ?? '');

  async function submit(values: CreateTransactionInput) {
    await update.mutateAsync(values);
    toast.success('Changes saved');
    navigate('/transactions');
  }

  const notFound = transaction.error instanceof ApiError && transaction.error.status === 404;

  return (
    <div>
      <h1 className="font-display text-4xl">Edit transaction</h1>
      <div className="mt-8 max-w-2xl">
        {transaction.isPending || accounts.isPending || categories.isPending ? (
          <Loading />
        ) : notFound ? (
          <EmptyState
            title="That transaction doesn't exist"
            description="It may have been deleted."
            action={<Button onClick={() => navigate('/transactions')}>Back to transactions</Button>}
          />
        ) : transaction.isError || accounts.isError || categories.isError ? (
          <EmptyState
            title="Couldn't load this transaction"
            description="Check your connection and try again."
            action={<Button onClick={() => void transaction.refetch()}>Try again</Button>}
          />
        ) : (
          <TransactionForm
            mode="edit"
            accounts={accounts.data!.accounts}
            categories={categories.data!.categories}
            initial={transaction.data!}
            onSubmit={submit}
            onCancel={() => navigate(-1)}
          />
        )}
      </div>
    </div>
  );
}
