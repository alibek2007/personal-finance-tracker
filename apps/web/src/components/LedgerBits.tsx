import { format, parseISO } from 'date-fns';
import { ArrowLeftRight } from 'lucide-react';
import { addDays, money, todayInZone, type CurrencyCode } from '@pfm/finance';
import type { AccountDto, CategoryDto, TransactionDto } from '@pfm/validation';
import { Amount, cn, type AmountKind } from '@pfm/ui';
import { useCurrentUser } from '../lib/auth';

/** Money in the signed-in user's locale. `minor` is integer minor units. */
export function AmountText({
  minor,
  currency,
  kind,
  className,
  compactFraction,
  tone,
}: {
  minor: number;
  currency: CurrencyCode;
  kind?: AmountKind;
  className?: string;
  compactFraction?: boolean;
  /** Set false to show the sign without green/red (e.g. when 'more' is not 'good'). */
  tone?: boolean;
}) {
  const { locale } = useCurrentUser();
  return (
    <Amount
      money={money(minor, currency)}
      locale={locale}
      {...(kind ? { kind } : {})}
      {...(className ? { className } : {})}
      {...(compactFraction ? { compactFraction } : {})}
      {...(tone !== undefined ? { tone } : {})}
    />
  );
}

/** Today's calendar date (YYYY-MM-DD) in the signed-in user's timezone, the same clock the server uses. */
export function useToday(): string {
  const { timezone } = useCurrentUser();
  try {
    return todayInZone(new Date(), timezone);
  } catch {
    return format(new Date(), 'yyyy-MM-dd');
  }
}

/**
 * "Today" / "Yesterday" relative to the user's own timezone, never the browser's, so labels and
 * dashboard figures cannot disagree.
 */
export function useFormatDay(): (iso: string) => string {
  const today = useToday();
  return (iso) => {
    if (iso === today) return 'Today';
    if (iso === addDays(today, -1)) return 'Yesterday';
    const date = parseISO(iso);
    return format(date, iso.slice(0, 4) === today.slice(0, 4) ? 'EEE, MMM d' : 'MMM d, yyyy');
  };
}

export const formatShortDate = (iso: string) => format(parseISO(iso), 'MMM d');

export function CategoryDot({ color, className }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block size-2.5 shrink-0 rounded-full', className)}
      style={{ background: color }}
    />
  );
}

/** Grouped <select> options: parents as optgroups with their subcategories beneath. */
export function CategoryOptions({
  categories,
  type,
  includeArchivedId,
}: {
  categories: CategoryDto[];
  type: 'income' | 'expense';
  /** Keep the currently selected category visible even if it has since been archived. */
  includeArchivedId?: string | null | undefined;
}) {
  const usable = (c: CategoryDto) =>
    c.type === type && (!c.isArchived || c.id === includeArchivedId);
  const parents = categories.filter(
    (c) => !c.parentId && (usable(c) || categories.some((k) => k.parentId === c.id && usable(k))),
  );
  return (
    <>
      {parents.map((parent) => {
        const children = categories.filter((c) => c.parentId === parent.id && usable(c));
        if (children.length === 0) {
          return (
            <option key={parent.id} value={parent.id}>
              {parent.name}
            </option>
          );
        }
        return (
          <optgroup key={parent.id} label={parent.name}>
            {usable(parent) ? <option value={parent.id}>{parent.name} (general)</option> : null}
            {children.map((child) => (
              <option key={child.id} value={child.id}>
                {child.name}
              </option>
            ))}
          </optgroup>
        );
      })}
    </>
  );
}

export function transactionTitle(t: TransactionDto, accounts: Map<string, AccountDto>): string {
  if (t.type !== 'transfer') return t.description;
  const to = t.transferAccountId ? accounts.get(t.transferAccountId)?.name : undefined;
  const from = accounts.get(t.accountId)?.name;
  return from && to ? `${t.description} (${from} → ${to})` : t.description;
}

export function TransferGlyph() {
  return <ArrowLeftRight aria-hidden className="size-3.5" />;
}

/**
 * Expense then income categories for filter/bulk pickers. <optgroup> cannot nest, so the two kinds are
 * separated by disabled heading options instead (nesting would silently drop options in browsers).
 */
export function AllCategoryOptions({
  categories,
  includeArchivedId,
}: {
  categories: CategoryDto[];
  includeArchivedId?: string | null | undefined;
}) {
  return (
    <>
      <option disabled>Expenses</option>
      <CategoryOptions
        categories={categories}
        type="expense"
        includeArchivedId={includeArchivedId}
      />
      <option disabled>Income</option>
      <CategoryOptions
        categories={categories}
        type="income"
        includeArchivedId={includeArchivedId}
      />
    </>
  );
}
