import type { CurrencyCode } from './currency';
import { MoneyError } from './money';

/**
 * Pure double-entry-style rules for how a transaction moves account balances.
 * Everything here works in integer minor units of each account's own currency.
 *
 *   income    +amount on `accountId`
 *   expense   -amount on `accountId`
 *   transfer  -amount on `accountId`, +transferAmount on `transferAccountId`
 *
 * Transfers are one record and are never income or expense.
 * Credit cards are ordinary accounts whose balance is negative when money is owed.
 */

export type LedgerTxType = 'income' | 'expense' | 'transfer';

export interface LedgerTx {
  type: LedgerTxType;
  accountId: string;
  /** Always positive; direction comes from `type`. */
  amount: number;
  transferAccountId?: string | null | undefined;
  /** Amount credited to the destination (differs from `amount` when currencies differ). */
  transferAmount?: number | null | undefined;
}

export interface BalanceDelta {
  accountId: string;
  delta: number;
}

function assertAmount(amount: number): void {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new MoneyError('Transaction amounts must be positive whole minor units');
  }
}

export function ledgerEffects(tx: LedgerTx): BalanceDelta[] {
  assertAmount(tx.amount);
  switch (tx.type) {
    case 'income':
      return [{ accountId: tx.accountId, delta: tx.amount }];
    case 'expense':
      return [{ accountId: tx.accountId, delta: -tx.amount }];
    case 'transfer': {
      if (!tx.transferAccountId) throw new MoneyError('A transfer needs a destination account');
      if (tx.transferAccountId === tx.accountId) {
        throw new MoneyError('A transfer needs two different accounts');
      }
      const credited = tx.transferAmount ?? tx.amount;
      assertAmount(credited);
      return [
        { accountId: tx.accountId, delta: -tx.amount },
        { accountId: tx.transferAccountId, delta: credited },
      ];
    }
  }
}

/** Sums deltas per account and drops accounts that net to zero. */
export function mergeDeltas(deltas: readonly BalanceDelta[]): BalanceDelta[] {
  const totals = new Map<string, number>();
  for (const { accountId, delta } of deltas) {
    const next = (totals.get(accountId) ?? 0) + delta;
    if (!Number.isSafeInteger(next)) throw new MoneyError('Balance change exceeds the safe range');
    totals.set(accountId, next);
  }
  return [...totals]
    .filter(([, delta]) => delta !== 0)
    .map(([accountId, delta]) => ({ accountId, delta }));
}

/** Net change for editing `before` into `after`: undo the old effect, apply the new one. */
export function editEffects(before: LedgerTx, after: LedgerTx): BalanceDelta[] {
  const undo = ledgerEffects(before).map((d) => ({ ...d, delta: -d.delta }));
  return mergeDeltas([...undo, ...ledgerEffects(after)]);
}

/** Effect of deleting a transaction. */
export function deleteEffects(tx: LedgerTx): BalanceDelta[] {
  return mergeDeltas(ledgerEffects(tx).map((d) => ({ ...d, delta: -d.delta })));
}

/** Balance an account should have: opening balance plus every transaction that touches it. */
export function recomputeBalance(
  accountId: string,
  initialBalance: number,
  transactions: readonly LedgerTx[],
): number {
  let balance = initialBalance;
  for (const tx of transactions) {
    for (const effect of ledgerEffects(tx)) {
      if (effect.accountId === accountId) balance += effect.delta;
    }
  }
  if (!Number.isSafeInteger(balance)) throw new MoneyError('Balance exceeds the safe range');
  return balance;
}

export interface DailyBalancePoint {
  /** YYYY-MM-DD */
  date: string;
  balance: number;
}

/**
 * Closing balance for each day that has activity, oldest first.
 * `opening` is the balance before the first transaction in `transactions`.
 */
export function balanceHistory(
  accountId: string,
  opening: number,
  transactions: readonly (LedgerTx & { date: string })[],
): DailyBalancePoint[] {
  const byDay = new Map<string, number>();
  for (const tx of transactions) {
    for (const effect of ledgerEffects(tx)) {
      if (effect.accountId === accountId) {
        byDay.set(tx.date, (byDay.get(tx.date) ?? 0) + effect.delta);
      }
    }
  }
  let running = opening;
  return [...byDay.keys()].sort().map((date) => {
    running += byDay.get(date) ?? 0;
    return { date, balance: running };
  });
}

// ------------------------------------------------------------------ validation

export interface LedgerContext {
  accountCurrency: CurrencyCode;
  transferAccountCurrency?: CurrencyCode | undefined;
  /** Type of the chosen category, if any. */
  categoryType?: 'income' | 'expense' | undefined;
}

export interface LedgerIssue {
  field: string;
  message: string;
}

/** Business rules that need more than the request shape. Returns every problem found. */
export function validateLedgerTx(
  tx: LedgerTx & { currency: CurrencyCode; hasCategory?: boolean; isRefund?: boolean },
  ctx: LedgerContext,
): LedgerIssue[] {
  const issues: LedgerIssue[] = [];
  if (!Number.isSafeInteger(tx.amount) || tx.amount <= 0) {
    issues.push({ field: 'amount', message: 'Enter an amount greater than zero.' });
  }
  if (tx.currency !== ctx.accountCurrency) {
    issues.push({
      field: 'currency',
      message: `This account uses ${ctx.accountCurrency}, so the amount must be in ${ctx.accountCurrency}.`,
    });
  }
  if (tx.type === 'transfer') {
    if (!tx.transferAccountId) {
      issues.push({ field: 'transferAccountId', message: 'Choose the account to move money to.' });
    } else if (tx.transferAccountId === tx.accountId) {
      issues.push({
        field: 'transferAccountId',
        message: 'Choose a different account to move money to.',
      });
    } else if (ctx.transferAccountCurrency) {
      const same = ctx.transferAccountCurrency === ctx.accountCurrency;
      if (same && tx.transferAmount != null && tx.transferAmount !== tx.amount) {
        issues.push({
          field: 'transferAmount',
          message: 'Both accounts use the same currency, so the amounts must match.',
        });
      }
      if (!same && (tx.transferAmount == null || tx.transferAmount <= 0)) {
        issues.push({
          field: 'transferAmount',
          message: `Enter how much arrives in the ${ctx.transferAccountCurrency} account.`,
        });
      }
    }
    if (tx.hasCategory) {
      issues.push({ field: 'categoryId', message: 'Transfers do not have a category.' });
    }
  } else {
    if (tx.transferAccountId) {
      issues.push({
        field: 'transferAccountId',
        message: 'Only transfers move money to another account.',
      });
    }
    if (tx.isRefund) {
      // A refund is money coming back: income that nets against the original expense category.
      if (tx.type !== 'income') {
        issues.push({ field: 'isRefund', message: 'Only income can be marked as a refund.' });
      } else if (ctx.categoryType && ctx.categoryType !== 'expense') {
        issues.push({
          field: 'categoryId',
          message: 'A refund goes in the expense category it is returning money to.',
        });
      }
    } else if (ctx.categoryType && ctx.categoryType !== tx.type) {
      issues.push({
        field: 'categoryId',
        message: `Pick a ${tx.type} category for ${tx.type === 'income' ? 'income' : 'an expense'}.`,
      });
    }
  }
  return issues;
}

// ------------------------------------------------------------------ account summaries

export interface AccountBalance {
  currency: CurrencyCode;
  balance: number;
  isArchived?: boolean;
}

export interface CurrencyTotals {
  currency: CurrencyCode;
  /** Sum of positive balances. */
  assets: number;
  /** Sum of negative balances, as a positive number owed. */
  debts: number;
  /** assets - debts. Debt reduces wealth; it is never added to it. */
  netWorth: number;
}

/**
 * Per-currency totals. Currencies are never added together: that needs an explicit FX rate,
 * and silently mixing them would produce wrong numbers.
 */
export function summarizeBalances(accounts: readonly AccountBalance[]): CurrencyTotals[] {
  const byCurrency = new Map<CurrencyCode, CurrencyTotals>();
  for (const account of accounts) {
    if (account.isArchived && account.balance === 0) continue;
    const entry = byCurrency.get(account.currency) ?? {
      currency: account.currency,
      assets: 0,
      debts: 0,
      netWorth: 0,
    };
    if (account.balance >= 0) entry.assets += account.balance;
    else entry.debts += -account.balance;
    entry.netWorth = entry.assets - entry.debts;
    byCurrency.set(account.currency, entry);
  }
  return [...byCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

// ------------------------------------------------------------------ balances over time

export interface BalanceSeriesPoint {
  date: string;
  total: number;
  byAccount: Record<string, number>;
}

/**
 * Each account's balance at the end of each given date: opening balance plus every transaction
 * dated on or before it. The total adds debts as negatives, so it is net worth. `dates` ascending.
 */
export function balanceSeries(
  accounts: readonly { id: string; initialBalance: number }[],
  transactions: readonly (LedgerTx & { date: string })[],
  dates: readonly string[],
): BalanceSeriesPoint[] {
  const known = new Set(accounts.map((a) => a.id));
  const events = transactions
    .flatMap((tx) => ledgerEffects(tx).map((e) => ({ date: tx.date, ...e })))
    .filter((e) => known.has(e.accountId))
    .sort((a, b) => a.date.localeCompare(b.date));
  const balance = new Map(accounts.map((a) => [a.id, a.initialBalance]));
  const points: BalanceSeriesPoint[] = [];
  let i = 0;
  for (const date of dates) {
    while (i < events.length && events[i]!.date <= date) {
      const e = events[i]!;
      balance.set(e.accountId, (balance.get(e.accountId) ?? 0) + e.delta);
      i += 1;
    }
    let total = 0;
    const byAccount: Record<string, number> = {};
    for (const [id, value] of balance) {
      byAccount[id] = value;
      total += value;
    }
    if (!Number.isSafeInteger(total)) throw new MoneyError('Balance exceeds the safe range');
    points.push({ date, total, byAccount });
  }
  return points;
}
