import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Archive, ArchiveRestore, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DrawerContent,
  EmptyState,
  Skeleton,
  Stat,
  toast,
} from '@pfm/ui';
import type { AccountDto, AccountListDto } from '@pfm/validation';
import {
  AmountText,
  CategoryDot,
  TransferGlyph,
  formatShortDate,
  transactionTitle,
} from '../../components/LedgerBits';
import { ApiError } from '../../lib/api';
import { useCurrentUser } from '../../lib/auth';
import {
  buildAccountIndex,
  useAccounts,
  useDeleteAccount,
  useTransactions,
  useUpdateAccount,
} from '../../lib/ledger';
import { AccountDialog } from './AccountDialog';
import { ACCOUNT_TYPE_LABELS } from './labels';

const NO_TOTALS: AccountListDto['totals'] = [];
const GROUPS: { title: string; types: AccountDto['type'][] }[] = [
  { title: 'Cash and bank', types: ['cash', 'bank'] },
  { title: 'Savings', types: ['savings'] },
  { title: 'Credit cards', types: ['credit_card'] },
  { title: 'Investments', types: ['investment'] },
  { title: 'Other', types: ['other'] },
];

const errorText = (error: unknown) =>
  error instanceof ApiError
    ? error.message
    : "Couldn't complete that. Check your connection and try again.";

function AccountRow({ account, onOpen }: { account: AccountDto; onOpen: () => void }) {
  const owed = account.type === 'credit_card';
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-4 border-b border-rule py-4 text-left transition-colors hover:bg-sunk/60 focus-visible:bg-sunk/60"
      >
        <CategoryDot color={account.color} className="size-3" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{account.name}</span>
          <span className="block truncate text-[0.8125rem] text-muted">
            {[ACCOUNT_TYPE_LABELS[account.type], account.institution].filter(Boolean).join(' · ')}
          </span>
        </span>
        <span className="text-right">
          <span className="block text-lg font-medium">
            <AmountText minor={account.currentBalance} currency={account.currency} />
          </span>
          {owed ? (
            <span className="block text-[0.8125rem] text-muted">
              {account.currentBalance < 0
                ? 'owed'
                : account.currentBalance === 0
                  ? 'paid off'
                  : 'in credit'}
            </span>
          ) : null}
        </span>
      </button>
    </li>
  );
}

export function AccountsPage() {
  const user = useCurrentUser();
  const [params, setParams] = useSearchParams();
  const accountsQuery = useAccounts();
  const [editing, setEditing] = useState<AccountDto | 'new' | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  // "Add your first account" links land here with ?new=1.
  useEffect(() => {
    if (params.get('new') === '1') {
      setEditing('new');
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  const all = accountsQuery.data?.accounts ?? [];
  const active = all.filter((a) => !a.isArchived);
  const archived = all.filter((a) => a.isArchived);
  const totals = accountsQuery.data?.totals ?? NO_TOTALS;
  const opened = all.find((a) => a.id === openId) ?? null;

  const orderedTotals = useMemo(
    () =>
      [...totals].sort(
        (a, b) => Number(b.currency === user.currency) - Number(a.currency === user.currency),
      ),
    [totals, user.currency],
  );
  const [primary, ...others] = orderedTotals;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-display text-4xl">Accounts</h1>
        <Button onClick={() => setEditing('new')}>
          <Plus aria-hidden /> Add account
        </Button>
      </div>

      {accountsQuery.isPending ? (
        <div role="status" aria-label="Loading accounts" className="mt-8 space-y-4">
          <Skeleton className="h-16 w-72" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : accountsQuery.isError ? (
        <EmptyState
          className="mt-8"
          title="Couldn't load your accounts"
          description={`${errorText(accountsQuery.error)} Your data is safe.`}
          action={<Button onClick={() => void accountsQuery.refetch()}>Try again</Button>}
        />
      ) : all.length === 0 ? (
        <EmptyState
          className="mt-8"
          title="You haven't added any accounts yet"
          description="Add the places your money lives (checking, cash, a credit card) and Ledger will show your real net worth."
          action={
            <Button onClick={() => setEditing('new')}>
              <Plus aria-hidden /> Add your first account
            </Button>
          }
        />
      ) : (
        <>
          {primary ? (
            <section aria-label="Net worth" className="mt-8 border-b border-rule pb-8">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
                <Stat
                  label={others.length ? `Net worth in ${primary.currency}` : 'Net worth'}
                  size="large"
                  className="col-span-2 sm:col-span-1"
                >
                  <AmountText
                    minor={primary.netWorth}
                    currency={primary.currency}
                    compactFraction
                  />
                </Stat>
                <Stat label="What you own" note="Cash, savings, other balances">
                  <AmountText minor={primary.assets} currency={primary.currency} compactFraction />
                </Stat>
                <Stat label="What you owe" note="Debts, subtracted from net worth">
                  <AmountText minor={primary.debts} currency={primary.currency} compactFraction />
                </Stat>
              </dl>
              {others.length > 0 ? (
                <div className="mt-6 text-[0.9375rem] text-muted">
                  <p>
                    You also hold{' '}
                    {others.map((t, i) => (
                      <span key={t.currency}>
                        {i > 0 ? ', ' : ''}
                        <strong className="font-medium text-ink">
                          <AmountText minor={t.netWorth} currency={t.currency} compactFraction />
                        </strong>
                      </span>
                    ))}
                    . Ledger keeps currencies separate rather than guessing an exchange rate.
                  </p>
                </div>
              ) : null}
            </section>
          ) : null}

          {GROUPS.map((group) => {
            const rows = active.filter((a) => group.types.includes(a.type));
            if (rows.length === 0) return null;
            return (
              <section key={group.title} className="mt-8" aria-labelledby={`group-${group.title}`}>
                <h2 id={`group-${group.title}`} className="font-display text-xl">
                  {group.title}
                </h2>
                <ul className="mt-2 border-t border-rule">
                  {rows.map((a) => (
                    <AccountRow key={a.id} account={a} onOpen={() => setOpenId(a.id)} />
                  ))}
                </ul>
              </section>
            );
          })}

          {archived.length > 0 ? (
            <section className="mt-10">
              <button
                type="button"
                className="text-[0.9375rem] font-medium text-accent underline-offset-4 hover:underline"
                aria-expanded={showArchived}
                onClick={() => setShowArchived((s) => !s)}
              >
                {showArchived ? 'Hide' : 'Show'} {archived.length} archived account
                {archived.length === 1 ? '' : 's'}
              </button>
              {showArchived ? (
                <ul className="mt-2 border-t border-rule">
                  {archived.map((a) => (
                    <AccountRow key={a.id} account={a} onOpen={() => setOpenId(a.id)} />
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}
        </>
      )}

      <AccountDialog
        key={editing === 'new' ? 'new' : (editing?.id ?? 'none')}
        open={editing !== null}
        account={editing && editing !== 'new' ? editing : null}
        onOpenChange={(open) => !open && setEditing(null)}
      />

      <AccountDrawer
        account={opened}
        onClose={() => setOpenId(null)}
        onEdit={(a) => {
          setOpenId(null);
          setEditing(a);
        }}
      />
    </div>
  );
}

function AccountDrawer({
  account,
  onClose,
  onEdit,
}: {
  account: AccountDto | null;
  onClose: () => void;
  onEdit: (a: AccountDto) => void;
}) {
  const update = useUpdateAccount(account?.id ?? '');
  const remove = useDeleteAccount();
  const accounts = useAccounts();
  const index = useMemo(() => buildAccountIndex(accounts.data?.accounts), [accounts.data]);
  const recent = useTransactions({
    accountId: account?.id ?? '__none',
    pageSize: 8,
    sort: 'date',
    dir: 'desc',
    page: 1,
  });
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function toggleArchive() {
    if (!account) return;
    try {
      await update.mutateAsync({ isArchived: !account.isArchived });
      toast.success(account.isArchived ? `${account.name} restored` : `${account.name} archived`);
      onClose();
    } catch (error) {
      toast.error(errorText(error));
    }
  }

  async function doDelete() {
    if (!account) return;
    setConfirmDelete(false);
    try {
      await remove.mutateAsync(account.id);
      toast.success('Account deleted');
      onClose();
    } catch (error) {
      toast.error(errorText(error));
    }
  }

  return (
    <>
      <Dialog open={account !== null} onOpenChange={(open) => !open && onClose()}>
        {account ? (
          <DrawerContent title={account.name} description={ACCOUNT_TYPE_LABELS[account.type]}>
            <div className="flex items-end justify-between gap-4">
              <dl>
                <Stat
                  label={
                    account.type === 'credit_card' ? 'Balance (negative means you owe)' : 'Balance'
                  }
                >
                  <AmountText minor={account.currentBalance} currency={account.currency} />
                </Stat>
              </dl>
              {account.isArchived ? <Badge>Archived</Badge> : null}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => onEdit(account)}>
                <Pencil aria-hidden /> Edit
              </Button>
              <Button
                variant="secondary"
                size="sm"
                loading={update.isPending}
                onClick={() => void toggleArchive()}
              >
                {account.isArchived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
                {account.isArchived ? 'Restore' : 'Archive'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
                <Trash2 aria-hidden /> Delete
              </Button>
            </div>

            <section aria-label="Recent activity">
              <div className="flex items-baseline justify-between border-b border-rule pb-2">
                <h3 className="font-display text-lg">Recent activity</h3>
                <Link
                  to={`/transactions?account=${account.id}`}
                  className="text-[0.8125rem] font-medium text-accent hover:underline"
                  onClick={onClose}
                >
                  See all
                </Link>
              </div>
              {recent.isPending ? (
                <div className="mt-3 space-y-2" role="status" aria-label="Loading activity">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : recent.isError ? (
                <p className="mt-3 text-muted">
                  Couldn't load activity. Close and reopen to try again.
                </p>
              ) : recent.data.items.length === 0 ? (
                <p className="mt-3 text-muted">No transactions in this account yet.</p>
              ) : (
                <ul>
                  {recent.data.items.map((t) => {
                    const incoming = t.type === 'transfer' && t.transferAccountId === account.id;
                    return (
                      <li
                        key={t.id}
                        className="flex items-center gap-3 border-b border-rule py-2.5"
                      >
                        <span className="w-12 shrink-0 text-[0.8125rem] text-muted">
                          {formatShortDate(t.date)}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {transactionTitle(t, index)}
                        </span>
                        <span className="inline-flex items-center gap-1 font-medium">
                          {t.type === 'transfer' ? <TransferGlyph /> : null}
                          {incoming ? (
                            <AmountText
                              minor={t.transferAmount ?? t.amount}
                              currency={account.currency}
                              kind="income"
                            />
                          ) : (
                            <AmountText
                              minor={t.amount}
                              currency={t.currency}
                              kind={t.type === 'income' ? 'income' : 'expense'}
                            />
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </DrawerContent>
        ) : null}
      </Dialog>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent
          title={`Delete ${account?.name ?? 'account'}?`}
          description="Only accounts without any transactions can be deleted. If this one has history, archive it instead to keep your records intact."
        >
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Keep it
            </Button>
            <Button variant="danger" onClick={() => void doDelete()}>
              Delete account
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
