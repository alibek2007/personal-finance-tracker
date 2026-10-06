import type { Account, Prisma } from '@prisma/client';
import {
  balanceHistory,
  isCurrencyCode,
  recomputeBalance,
  summarizeBalances,
  type CurrencyCode,
  type LedgerTx,
} from '@pfm/finance';
import type {
  AccountDto,
  AccountListDto,
  CreateAccountInput,
  UpdateAccountInput,
} from '@pfm/validation';
import type { Db } from '../../lib/db';
import { fromMinor, toIsoDate, toMinor, toMinorOrNull } from '../../lib/convert';
import { AppError } from '../../utils/errors';

export function toAccountDto(a: Account): AccountDto {
  return {
    id: a.id,
    name: a.name,
    type: a.type,
    institution: a.institution,
    currency: (isCurrencyCode(a.currency) ? a.currency : 'USD') as CurrencyCode,
    initialBalance: toMinor(a.initialBalance),
    currentBalance: toMinor(a.currentBalance),
    color: a.color,
    icon: a.icon,
    isArchived: a.isArchived,
  };
}

export interface BalanceDrift {
  accountId: string;
  name: string;
  stored: number;
  expected: number;
}

type TxClient = Prisma.TransactionClient | Db;

/** Every transaction that touches an account, as ledger inputs (outgoing and incoming transfers). */
export async function ledgerTxsForAccount(
  client: TxClient,
  userId: string,
  accountId: string,
): Promise<(LedgerTx & { date: string })[]> {
  const rows = await client.transaction.findMany({
    where: { userId, OR: [{ accountId }, { transferAccountId: accountId }] },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
  });
  return rows.map((r) => ({
    type: r.type,
    accountId: r.accountId,
    amount: toMinor(r.amount),
    transferAccountId: r.transferAccountId,
    transferAmount: toMinorOrNull(r.transferAmount),
    date: toIsoDate(r.date),
  }));
}

export function createAccountsService(db: Db) {
  async function findOwned(userId: string, id: string): Promise<Account> {
    const account = await db.account.findFirst({ where: { id, userId } });
    if (!account) throw AppError.notFound('That account');
    return account;
  }

  async function assertNameFree(userId: string, name: string, exceptId?: string) {
    const clash = await db.account.findFirst({
      where: {
        userId,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
    });
    if (clash) {
      throw AppError.conflict(
        `You already have an account called "${name}".`,
        'account_name_taken',
      );
    }
  }

  return {
    findOwned,

    async list(userId: string, includeArchived = false): Promise<AccountListDto> {
      const all = await db.account.findMany({
        where: { userId },
        orderBy: [{ isArchived: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
      });
      const dtos = all.map(toAccountDto);
      return {
        accounts: includeArchived ? dtos : dtos.filter((a) => !a.isArchived),
        // Totals always include archived accounts that still hold money, so net worth never silently drops.
        totals: summarizeBalances(
          dtos.map((a) => ({
            currency: a.currency,
            balance: a.currentBalance,
            isArchived: a.isArchived,
          })),
        ),
      };
    },

    async get(userId: string, id: string) {
      return toAccountDto(await findOwned(userId, id));
    },

    async create(userId: string, input: CreateAccountInput) {
      await assertNameFree(userId, input.name);
      const count = await db.account.count({ where: { userId } });
      const created = await db.account.create({
        data: {
          userId,
          name: input.name,
          type: input.type,
          institution: input.institution ?? null,
          currency: input.currency,
          initialBalance: fromMinor(input.initialBalance),
          currentBalance: fromMinor(input.initialBalance),
          color: input.color,
          icon: input.icon,
          sortOrder: count,
        },
      });
      return toAccountDto(created);
    },

    async update(userId: string, id: string, input: UpdateAccountInput) {
      const existing = await findOwned(userId, id);
      if (input.name && input.name.toLowerCase() !== existing.name.toLowerCase()) {
        await assertNameFree(userId, input.name, id);
      }
      const { initialBalance, ...rest } = input;
      const data: Prisma.AccountUpdateInput = { ...rest };
      if (initialBalance !== undefined) {
        // Correcting the opening balance shifts the running balance by the same amount.
        const diff = initialBalance - toMinor(existing.initialBalance);
        data.initialBalance = fromMinor(initialBalance);
        data.currentBalance = { increment: fromMinor(diff) };
      }
      return toAccountDto(await db.account.update({ where: { id }, data }));
    },

    /** Accounts with history cannot be deleted: that would rewrite the past. Archive instead. */
    async remove(userId: string, id: string) {
      await findOwned(userId, id);
      const used = await db.transaction.count({
        where: { userId, OR: [{ accountId: id }, { transferAccountId: id }] },
      });
      if (used > 0) {
        throw AppError.conflict(
          `This account has ${used} transaction${used === 1 ? '' : 's'}. Archive it instead to keep your history intact.`,
          'has_transactions',
        );
      }
      const [recurring] = await Promise.all([
        db.recurringTransaction.count({ where: { userId, accountId: id } }),
      ]);
      if (recurring > 0) {
        throw AppError.conflict(
          'Recurring payments use this account. Remove them first, or archive the account.',
          'has_recurring',
        );
      }
      await db.account.delete({ where: { id } });
    },

    async balanceHistory(userId: string, id: string) {
      const account = await findOwned(userId, id);
      const txs = await ledgerTxsForAccount(db, userId, id);
      return { points: balanceHistory(id, toMinor(account.initialBalance), txs) };
    },

    /**
     * Proves the cached `currentBalance` equals opening balance + every transaction.
     * Returns the accounts that disagree (should always be empty).
     */
    async reconcile(userId: string): Promise<BalanceDrift[]> {
      const accounts = await db.account.findMany({ where: { userId } });
      const drift: BalanceDrift[] = [];
      for (const account of accounts) {
        const txs = await ledgerTxsForAccount(db, userId, account.id);
        const expected = recomputeBalance(account.id, toMinor(account.initialBalance), txs);
        const stored = toMinor(account.currentBalance);
        if (expected !== stored)
          drift.push({ accountId: account.id, name: account.name, stored, expected });
      }
      return drift;
    },
  };
}

export type AccountsService = ReturnType<typeof createAccountsService>;
