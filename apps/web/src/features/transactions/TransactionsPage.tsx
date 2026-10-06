import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Ellipsis,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
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
import { MoneyError, parseMoney } from '@pfm/finance';
import type { AccountDto, CategoryDto, TransactionDto, TransactionFilter } from '@pfm/validation';
import {
  AmountText,
  CategoryDot,
  AllCategoryOptions,
  TransferGlyph,
  useFormatDay,
  formatShortDate,
  transactionTitle,
} from '../../components/LedgerBits';
import { ApiError } from '../../lib/api';
import { useCurrentUser } from '../../lib/auth';
import {
  buildAccountIndex,
  buildCategoryIndex,
  NO_ACCOUNTS,
  NO_CATEGORIES,
  useAccounts,
  useBulkCategorize,
  useBulkDelete,
  useCategories,
  useDeleteTransaction,
  filterToQuery,
  useTransactions,
} from '../../lib/ledger';
import { downloadTransactionsCsv } from '../../lib/data-transfer';

const PAGE_SIZE = 25;
const TYPE_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'expense', label: 'Expenses' },
  { value: 'income', label: 'Income' },
  { value: 'transfer', label: 'Transfers' },
] as const;

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

/** The URL is the source of truth for filters, so views are shareable and the back button works. */
function useFilters() {
  const [params, setParams] = useSearchParams();
  const { currency } = useCurrentUser();

  const decimal = (key: string): number | undefined => {
    const raw = params.get(key);
    if (!raw) return undefined;
    try {
      return parseMoney(raw, currency).minor;
    } catch (error) {
      if (error instanceof MoneyError) return undefined;
      throw error;
    }
  };

  const type = params.get('type');
  const from = params.get('from');
  const to = params.get('to');
  const filter: Partial<TransactionFilter> = {
    ...(params.get('q') ? { q: params.get('q')! } : {}),
    ...(type === 'income' || type === 'expense' || type === 'transfer' ? { type } : {}),
    ...(params.get('account') ? { accountId: params.get('account')! } : {}),
    ...(params.get('category') ? { categoryId: params.get('category')! } : {}),
    ...(params.get('uncategorized') === 'true' ? { uncategorized: true } : {}),
    ...(from && isoDate.test(from) ? { dateFrom: from } : {}),
    ...(to && isoDate.test(to) ? { dateTo: to } : {}),
    ...(decimal('min') !== undefined ? { amountMin: decimal('min')! } : {}),
    ...(decimal('max') !== undefined ? { amountMax: decimal('max')! } : {}),
    sort: params.get('sort') === 'amount' ? 'amount' : 'date',
    dir: params.get('dir') === 'asc' ? 'asc' : 'desc',
    page: Math.max(1, Number(params.get('page')) || 1),
    pageSize: PAGE_SIZE,
  };

  function set(changes: Record<string, string | null>, resetPage = true) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(changes)) {
          if (value === null || value === '') next.delete(key);
          else next.set(key, value);
        }
        if (resetPage) next.delete('page');
        return next;
      },
      { replace: true },
    );
  }

  const active = [
    'q',
    'type',
    'account',
    'category',
    'uncategorized',
    'from',
    'to',
    'min',
    'max',
  ].some((k) => params.has(k));
  return { params, filter, set, active, clear: () => setParams({}, { replace: true }) };
}

export function TransactionsPage() {
  const navigate = useNavigate();
  const user = useCurrentUser();
  const { params, filter, set, active, clear } = useFilters();
  const accountsQuery = useAccounts();
  const categoriesQuery = useCategories();
  const list = useTransactions(filter);
  const del = useDeleteTransaction();
  const bulkDelete = useBulkDelete();
  const bulkCategorize = useBulkCategorize();

  const accounts = accountsQuery.data?.accounts ?? NO_ACCOUNTS;
  const categories = categoriesQuery.data?.categories ?? NO_CATEGORIES;
  const accountIndex = useMemo(() => buildAccountIndex(accounts), [accounts]);
  const categoryIndex = useMemo(() => buildCategoryIndex(categories), [categories]);

  // Search box: type freely, update the URL shortly after.
  const [search, setSearch] = useState(params.get('q') ?? '');
  useEffect(() => {
    const id = setTimeout(() => {
      if ((params.get('q') ?? '') !== search) set({ q: search.trim() || null });
    }, 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);
  useEffect(() => setSearch(params.get('q') ?? ''), [params]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selecting, setSelecting] = useState(false);
  const [exporting, setExporting] = useState(false);

  /** Exports what the filters show (every page), not just the 25 rows on screen. */
  async function exportCsv() {
    setExporting(true);
    try {
      await downloadTransactionsCsv(
        filterToQuery({
          ...filter,
          page: undefined,
          pageSize: undefined,
          sort: undefined,
          dir: undefined,
        }),
      );
      toast.success('Your export is ready');
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setExporting(false);
    }
  }
  const [pendingDelete, setPendingDelete] = useState<TransactionDto | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [showMore, setShowMore] = useState(Boolean(params.get('min') || params.get('max')));

  const activeDetailCount = [
    'account',
    'category',
    'uncategorized',
    'from',
    'to',
    'min',
    'max',
  ].filter((k) => params.has(k)).length;
  const queryKey = params.toString();
  useEffect(() => setSelected(new Set()), [queryKey]);

  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const page = filter.page ?? 1;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const allSelected = items.length > 0 && items.every((t) => selected.has(t.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function sortBy(column: 'date' | 'amount') {
    if (filter.sort === column)
      set({ sort: column, dir: filter.dir === 'desc' ? 'asc' : 'desc' }, false);
    else set({ sort: column, dir: 'desc' }, false);
  }

  const errorText = (error: unknown) =>
    error instanceof ApiError
      ? error.message
      : "Couldn't complete that. Check your connection and try again.";

  async function confirmDelete() {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    try {
      await del.mutateAsync(target.id);
      toast.success('Transaction deleted');
    } catch (error) {
      toast.error(errorText(error));
    }
  }

  async function runBulkDelete() {
    const ids = [...selected];
    setBulkDeleteOpen(false);
    try {
      const { count } = await bulkDelete.mutateAsync(ids);
      setSelected(new Set());
      toast.success(`${count} transaction${count === 1 ? '' : 's'} deleted`);
    } catch (error) {
      toast.error(errorText(error));
    }
  }

  async function runBulkCategory(value: string) {
    if (!value) return;
    try {
      const { count } = await bulkCategorize.mutateAsync({
        ids: [...selected],
        categoryId: value === '__none' ? null : value,
      });
      setSelected(new Set());
      toast.success(`Category updated on ${count} transaction${count === 1 ? '' : 's'}`);
    } catch (error) {
      toast.error(errorText(error));
    }
  }

  const rowActions = (t: TransactionDto) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label={`Actions for ${t.description}`} size="icon-sm">
          <Ellipsis />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => navigate(`/transactions/${t.id}/edit`)}>
          <Pencil aria-hidden /> Edit
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate(`/transactions/new?duplicate=${t.id}`)}>
          <Copy aria-hidden /> Duplicate
        </DropdownMenuItem>
        <DropdownMenuItem destructive onSelect={() => setPendingDelete(t)}>
          <Trash2 aria-hidden /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const amountCell = (t: TransactionDto) => (
    <span className="inline-flex items-center justify-end gap-1.5">
      {t.type === 'transfer' ? <TransferGlyph /> : null}
      <AmountText
        minor={t.amount}
        currency={t.currency}
        kind={t.type === 'income' ? 'income' : t.type === 'expense' ? 'expense' : 'transfer'}
      />
    </span>
  );

  const categoryCell = (t: TransactionDto) => {
    if (t.type === 'transfer') return <span className="text-muted">Transfer</span>;
    const c = t.categoryId ? categoryIndex.byId.get(t.categoryId) : undefined;
    return (
      <span className="inline-flex items-center gap-2">
        <CategoryDot color={c?.color ?? 'var(--rule-strong)'} />
        <span className={cn(!c && 'text-muted')}>{categoryIndex.label(t.categoryId)}</span>
        {t.isRefund ? <Badge tone="gain">Refund</Badge> : null}
        {t.isRecurring ? <Badge>Recurring</Badge> : null}
      </span>
    );
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl">Transactions</h1>
          <p className="mt-1 text-muted" aria-live="polite">
            {list.data
              ? `${total.toLocaleString(user.locale)} ${total === 1 ? 'transaction' : 'transactions'}${active ? ' match your filters' : ''}`
              : ' '}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            loading={exporting}
            onClick={() => void exportCsv()}
            aria-label={
              active ? 'Export matching transactions as CSV' : 'Export all transactions as CSV'
            }
          >
            <Download aria-hidden /> <span className="hidden sm:inline">Export CSV</span>
          </Button>
          <Button variant="secondary" className="md:hidden" onClick={() => setSelecting((s) => !s)}>
            {selecting ? 'Done' : 'Select'}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <section aria-label="Filters" className="mt-6 flex flex-col gap-4 border-y border-rule py-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-56 flex-1">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3 top-3 size-4 text-muted"
            />
            <Input
              type="search"
              aria-label="Search transactions"
              placeholder="Search description, merchant or category"
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <SegmentedControl
            label="Type"
            options={TYPE_OPTIONS}
            value={(filter.type ?? 'all') as (typeof TYPE_OPTIONS)[number]['value']}
            onChange={(v) => set({ type: v === 'all' ? null : v })}
          />
        </div>
        {/* On phones the detailed filters fold away so the list stays on the first screen. */}
        <button
          type="button"
          className="inline-flex min-h-10 items-center gap-2 self-start text-[0.9375rem] font-medium text-accent md:hidden"
          aria-expanded={filtersOpen}
          aria-controls="detailed-filters"
          onClick={() => setFiltersOpen((open) => !open)}
        >
          <SlidersHorizontal aria-hidden className="size-4" />
          {filtersOpen ? 'Hide filters' : 'Filters'}
          {activeDetailCount > 0 ? <Badge tone="accent">{activeDetailCount}</Badge> : null}
        </button>
        <div
          id="detailed-filters"
          className={cn('flex-col gap-4 md:flex', filtersOpen ? 'flex' : 'hidden')}
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Account" hideLabel>
              <Select
                aria-label="Account"
                value={filter.accountId ?? ''}
                onChange={(e) => set({ account: e.target.value || null })}
              >
                <option value="">All accounts</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.isArchived ? ' (archived)' : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Category" hideLabel>
              <Select
                aria-label="Category"
                value={filter.categoryId ?? ''}
                onChange={(e) => set({ category: e.target.value || null, uncategorized: null })}
              >
                <option value="">All categories</option>
                <AllCategoryOptions categories={categories} includeArchivedId={filter.categoryId} />
              </Select>
            </Field>
            <Field label="From date">
              <Input
                type="date"
                value={filter.dateFrom ?? ''}
                max={filter.dateTo}
                onChange={(e) => set({ from: e.target.value || null })}
              />
            </Field>
            <Field label="To date">
              <Input
                type="date"
                value={filter.dateTo ?? ''}
                min={filter.dateFrom}
                onChange={(e) => set({ to: e.target.value || null })}
              />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <button
              type="button"
              className="inline-flex min-h-8 items-center text-[0.8125rem] font-medium text-accent underline-offset-4 hover:underline"
              aria-expanded={showMore}
              onClick={() => setShowMore((s) => !s)}
            >
              {showMore ? 'Fewer filters' : 'More filters'}
            </button>
            <label className="flex items-center gap-2 text-[0.8125rem]">
              <input
                type="checkbox"
                className="size-4 accent-[var(--accent)]"
                checked={filter.uncategorized === true}
                onChange={(e) =>
                  set({ uncategorized: e.target.checked ? 'true' : null, category: null })
                }
              />
              Only uncategorised
            </label>
            {active ? (
              <button
                type="button"
                onClick={clear}
                className="ml-auto inline-flex items-center gap-1 text-[0.8125rem] font-medium text-accent underline-offset-4 hover:underline"
              >
                <X aria-hidden className="size-3.5" /> Clear filters
              </button>
            ) : null}
          </div>
          {showMore ? (
            <div className="grid max-w-md grid-cols-2 gap-3">
              <Field label={`Minimum amount (${user.currency})`}>
                <Input
                  inputMode="decimal"
                  placeholder="0.00"
                  defaultValue={params.get('min') ?? ''}
                  onBlur={(e) => set({ min: e.target.value.trim() || null })}
                />
              </Field>
              <Field label={`Maximum amount (${user.currency})`}>
                <Input
                  inputMode="decimal"
                  placeholder="Any"
                  defaultValue={params.get('max') ?? ''}
                  onBlur={(e) => set({ max: e.target.value.trim() || null })}
                />
              </Field>
            </div>
          ) : null}
        </div>
      </section>

      {/* Bulk bar */}
      {selected.size > 0 ? (
        <div
          role="region"
          aria-label="Bulk actions"
          className="sticky top-16 z-10 mt-3 flex flex-wrap items-center gap-3 rounded-md border border-accent/40 bg-accent-wash px-4 py-2.5"
        >
          <span className="font-medium">{selected.size} selected</span>
          <Select
            aria-label="Set category for selected"
            className="h-9 w-56"
            value=""
            onChange={(e) => void runBulkCategory(e.target.value)}
          >
            <option value="">Set category…</option>
            <option value="__none">Remove category</option>
            <AllCategoryOptions categories={categories} />
          </Select>
          <Button variant="danger" size="sm" onClick={() => setBulkDeleteOpen(true)}>
            <Trash2 aria-hidden /> Delete
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => setSelected(new Set())}
          >
            Clear selection
          </Button>
        </div>
      ) : null}

      {/* Results */}
      <div className="mt-4" aria-busy={list.isFetching || undefined}>
        {list.isPending ? (
          <div className="space-y-3" role="status" aria-label="Loading transactions">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : list.isError ? (
          <EmptyState
            title="Couldn't load your transactions"
            description={`${errorText(list.error)} Your data is safe.`}
            action={<Button onClick={() => void list.refetch()}>Try again</Button>}
          />
        ) : items.length === 0 ? (
          active ? (
            <EmptyState
              title="No transactions match these filters"
              description="Try a wider date range or remove a filter."
              action={
                <Button variant="secondary" onClick={clear}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              title="You haven't added any transactions yet"
              description="Record your first expense or paycheck and Ledger starts keeping score."
              action={
                <Button onClick={() => navigate('/transactions/new')}>
                  <Plus aria-hidden /> Add your first transaction
                </Button>
              }
            />
          )
        ) : (
          <>
            {/* Desktop table */}
            <div
              className="relative hidden overflow-x-auto md:block"
              role="region"
              aria-label="Transactions table"
              tabIndex={0}
            >
              <table className="w-full text-[0.9375rem]">
                <caption className="sr-only">Transactions, newest first</caption>
                <thead>
                  <tr className="border-b border-rule text-left text-[0.8125rem] text-muted">
                    <th className="w-10 py-2 pr-2">
                      <input
                        type="checkbox"
                        aria-label="Select all on this page"
                        className="size-4 accent-[var(--accent)]"
                        checked={allSelected}
                        onChange={() =>
                          setSelected(allSelected ? new Set() : new Set(items.map((t) => t.id)))
                        }
                      />
                    </th>
                    <th
                      scope="col"
                      className="py-2 pr-4 font-medium"
                      aria-sort={
                        filter.sort === 'date'
                          ? filter.dir === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                      }
                    >
                      <SortButton
                        label="Date"
                        active={filter.sort === 'date'}
                        dir={filter.dir}
                        onClick={() => sortBy('date')}
                      />
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Description
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Category
                    </th>
                    <th scope="col" className="hidden py-2 pr-4 font-medium xl:table-cell">
                      Account
                    </th>
                    <th
                      scope="col"
                      className="py-2 text-right font-medium"
                      aria-sort={
                        filter.sort === 'amount'
                          ? filter.dir === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                      }
                    >
                      <SortButton
                        label="Amount"
                        align="right"
                        active={filter.sort === 'amount'}
                        dir={filter.dir}
                        onClick={() => sortBy('amount')}
                      />
                    </th>
                    <th className="w-10">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((t) => (
                    <tr
                      key={t.id}
                      className={cn(
                        'group border-b border-rule transition-colors hover:bg-sunk/60',
                        selected.has(t.id) && 'bg-accent-wash/60',
                      )}
                    >
                      <td className="py-3 pr-2">
                        <input
                          type="checkbox"
                          aria-label={`Select ${t.description}`}
                          className="size-4 accent-[var(--accent)]"
                          checked={selected.has(t.id)}
                          onChange={() => toggle(t.id)}
                        />
                      </td>
                      <td className="whitespace-nowrap py-3 pr-4 text-muted">
                        {formatShortDate(t.date)}
                      </td>
                      <td className="max-w-72 py-3 pr-4">
                        <Link
                          to={`/transactions/${t.id}/edit`}
                          className="block truncate font-medium hover:underline"
                        >
                          {transactionTitle(t, accountIndex)}
                        </Link>
                        {t.merchant ? (
                          <span className="block truncate text-[0.8125rem] text-muted">
                            {t.merchant}
                          </span>
                        ) : null}
                      </td>
                      <td className="py-3 pr-4">{categoryCell(t)}</td>
                      <td className="hidden py-3 pr-4 text-muted xl:table-cell">
                        {accountIndex.get(t.accountId)?.name ?? '—'}
                      </td>
                      <td className="py-3 text-right font-medium">{amountCell(t)}</td>
                      <td className="py-3 pl-2 text-right">{rowActions(t)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile list, grouped by day */}
            <MobileList
              items={items}
              selecting={selecting}
              selected={selected}
              onToggle={toggle}
              accountIndex={accountIndex}
              categoryLabel={categoryIndex.label}
              rowActions={rowActions}
            />

            <nav
              aria-label="Pagination"
              className="mt-6 flex items-center justify-between gap-4 text-[0.8125rem] text-muted"
            >
              <span className="num">
                {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of{' '}
                {total.toLocaleString(user.locale)}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => set({ page: String(page - 1) }, false)}
                >
                  <ChevronLeft aria-hidden /> Previous
                </Button>
                <span className="num px-1">
                  Page {page} of {lastPage}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page >= lastPage}
                  onClick={() => set({ page: String(page + 1) }, false)}
                >
                  Next <ChevronRight aria-hidden />
                </Button>
              </div>
            </nav>
          </>
        )}
      </div>

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <DialogContent
          title="Delete this transaction?"
          description={
            pendingDelete
              ? `“${pendingDelete.description}” will be removed and the balance of ${accountIndex.get(pendingDelete.accountId)?.name ?? 'the account'} will be adjusted. This can't be undone.`
              : ''
          }
        >
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>
              Keep it
            </Button>
            <Button variant="danger" onClick={() => void confirmDelete()}>
              Delete transaction
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <DialogContent
          title={`Delete ${selected.size} transaction${selected.size === 1 ? '' : 's'}?`}
          description="Account balances will be adjusted. This can't be undone."
        >
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setBulkDeleteOpen(false)}>
              Keep them
            </Button>
            <Button variant="danger" onClick={() => void runBulkDelete()}>
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SortButton({
  label,
  active,
  dir,
  onClick,
  align,
}: {
  label: string;
  active: boolean;
  dir: 'asc' | 'desc' | undefined;
  onClick: () => void;
  align?: 'right';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 font-medium hover:text-ink',
        align === 'right' && 'ml-auto',
        active && 'text-ink',
      )}
    >
      {label}
      {active ? (
        dir === 'asc' ? (
          <ArrowUp aria-hidden className="size-3.5" />
        ) : (
          <ArrowDown aria-hidden className="size-3.5" />
        )
      ) : null}
      <span className="sr-only">
        {active ? `, sorted ${dir === 'asc' ? 'ascending' : 'descending'}` : ', click to sort'}
      </span>
    </button>
  );
}

function MobileList({
  items,
  selecting,
  selected,
  onToggle,
  accountIndex,
  categoryLabel,
  rowActions,
}: {
  items: TransactionDto[];
  selecting: boolean;
  selected: Set<string>;
  onToggle: (id: string) => void;
  accountIndex: Map<string, AccountDto>;
  categoryLabel: (id: string | null | undefined) => string;
  rowActions: (t: TransactionDto) => React.ReactNode;
}) {
  const formatDay = useFormatDay();
  const days = useMemo(() => {
    const groups: { date: string; rows: TransactionDto[] }[] = [];
    for (const t of items) {
      const last = groups[groups.length - 1];
      if (last && last.date === t.date) last.rows.push(t);
      else groups.push({ date: t.date, rows: [t] });
    }
    return groups;
  }, [items]);

  return (
    <div className="md:hidden">
      {days.map((day) => (
        <section key={day.date} aria-label={formatDay(day.date)} className="mb-4">
          <h2 className="mb-1 text-[0.8125rem] font-medium text-muted">{formatDay(day.date)}</h2>
          <ul>
            {day.rows.map((t) => (
              <li key={t.id} className="flex items-center gap-3 border-b border-rule py-3">
                {selecting ? (
                  <input
                    type="checkbox"
                    aria-label={`Select ${t.description}`}
                    className="size-5 shrink-0 accent-[var(--accent)]"
                    checked={selected.has(t.id)}
                    onChange={() => onToggle(t.id)}
                  />
                ) : null}
                <Link to={`/transactions/${t.id}/edit`} className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{t.merchant || t.description}</span>
                  <span className="block truncate text-[0.8125rem] text-muted">
                    {t.type === 'transfer' ? 'Transfer' : categoryLabel(t.categoryId)} ·{' '}
                    {accountIndex.get(t.accountId)?.name}
                  </span>
                </Link>
                <span className="font-medium">
                  <span className="inline-flex items-center gap-1">
                    {t.type === 'transfer' ? <TransferGlyph /> : null}
                    <AmountText
                      minor={t.amount}
                      currency={t.currency}
                      kind={
                        t.type === 'income'
                          ? 'income'
                          : t.type === 'expense'
                            ? 'expense'
                            : 'transfer'
                      }
                    />
                  </span>
                </span>
                {!selecting ? rowActions(t) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export { type CategoryDto };
