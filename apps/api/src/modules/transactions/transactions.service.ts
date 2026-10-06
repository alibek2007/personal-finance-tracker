import type { Prisma, Transaction } from '@prisma/client';
import {
  deleteEffects,
  editEffects,
  isCurrencyCode,
  ledgerEffects,
  mergeDeltas,
  validateLedgerTx,
  type BalanceDelta,
  type CurrencyCode,
  type LedgerTx,
} from '@pfm/finance';
import type {
  CreateTransactionInput,
  SuggestionsDto,
  TransactionDto,
  TransactionFilter,
  TransactionListDto,
  UpdateTransactionInput,
} from '@pfm/validation';
import type { Db } from '../../lib/db';
import { fromIsoDate, fromMinor, toIsoDate, toMinor, toMinorOrNull } from '../../lib/convert';
import { AppError } from '../../utils/errors';

export function toTransactionDto(t: Transaction): TransactionDto {
  return {
    id: t.id,
    type: t.type,
    accountId: t.accountId,
    categoryId: t.categoryId,
    amount: toMinor(t.amount),
    currency: (isCurrencyCode(t.currency) ? t.currency : 'USD') as CurrencyCode,
    transferAccountId: t.transferAccountId,
    transferAmount: toMinorOrNull(t.transferAmount),
    isRefund: t.isRefund,
    description: t.description,
    merchant: t.merchant,
    date: toIsoDate(t.date),
    notes: t.notes,
    isRecurring: t.isRecurring,
    createdAt: t.createdAt.toISOString(),
  };
}

function asLedger(t: Transaction): LedgerTx {
  return {
    type: t.type,
    accountId: t.accountId,
    amount: toMinor(t.amount),
    transferAccountId: t.transferAccountId,
    transferAmount: toMinorOrNull(t.transferAmount),
  };
}

/** The complete, normalised state a transaction will have after a create or update. */
interface Candidate {
  type: 'income' | 'expense' | 'transfer';
  accountId: string;
  categoryId: string | null;
  amount: number;
  description: string;
  merchant: string | null;
  date: string;
  notes: string | null;
  transferAccountId: string | null;
  transferAmount: number | null;
  isRefund: boolean;
}

export function createTransactionsService(db: Db) {
  /** Applies balance changes inside the caller's DB transaction. Atomic increments avoid lost updates. */
  async function applyDeltas(tx: Prisma.TransactionClient, userId: string, deltas: BalanceDelta[]) {
    for (const { accountId, delta } of deltas) {
      const { count } = await tx.account.updateMany({
        where: { id: accountId, userId },
        data: { currentBalance: { increment: fromMinor(delta) } },
      });
      if (count !== 1) throw AppError.notFound('That account');
    }
  }

  /** Loads and checks everything a candidate references, then runs the shared ledger rules. */
  async function validate(userId: string, c: Candidate, existing?: Transaction) {
    const [account, destination, category] = await Promise.all([
      db.account.findFirst({ where: { id: c.accountId, userId } }),
      c.transferAccountId
        ? db.account.findFirst({ where: { id: c.transferAccountId, userId } })
        : null,
      c.categoryId ? db.category.findFirst({ where: { id: c.categoryId, userId } }) : null,
    ]);

    const details: Record<string, string[]> = {};
    const add = (field: string, message: string) => (details[field] ??= []).push(message);

    if (!account) add('accountId', 'Choose one of your accounts.');
    if (c.transferAccountId && !destination)
      add('transferAccountId', 'Choose one of your accounts.');
    if (c.categoryId && !category) add('categoryId', 'Choose one of your categories.');

    // New references to archived things are blocked; unchanged ones on an old record stay editable.
    if (account?.isArchived && existing?.accountId !== account.id) {
      add('accountId', 'That account is archived. Restore it or pick another.');
    }
    if (destination?.isArchived && existing?.transferAccountId !== destination.id) {
      add('transferAccountId', 'That account is archived. Restore it or pick another.');
    }
    if (category?.isArchived && existing?.categoryId !== category.id) {
      add('categoryId', 'That category is archived. Pick another.');
    }

    if (account) {
      const currency = (
        isCurrencyCode(account.currency) ? account.currency : 'USD'
      ) as CurrencyCode;
      const destCurrency =
        destination && isCurrencyCode(destination.currency)
          ? (destination.currency as CurrencyCode)
          : undefined;
      const issues = validateLedgerTx(
        {
          type: c.type,
          accountId: c.accountId,
          amount: c.amount,
          currency,
          transferAccountId: c.transferAccountId,
          transferAmount: c.transferAmount,
          hasCategory: c.categoryId !== null,
          isRefund: c.isRefund,
        },
        {
          accountCurrency: currency,
          transferAccountCurrency: destCurrency,
          categoryType: category?.type,
        },
      );
      for (const issue of issues) add(issue.field, issue.message);
    }

    if (Object.keys(details).length > 0) {
      throw AppError.badRequest('Some fields need attention.', 'validation_failed', details);
    }
    return { currency: account!.currency };
  }

  /**
   * When an edit changes the type, fields that only conflict because they were inherited from the old
   * type are cleared (an expense with a category becomes a transfer: the category goes). Anything the
   * caller sent explicitly is left alone so validation can reject it instead of silently dropping it.
   */
  function dropInherited(c: Candidate, patch: UpdateTransactionInput): Candidate {
    if (c.type === 'transfer') {
      return {
        ...c,
        categoryId: patch.categoryId === undefined ? null : c.categoryId,
        isRefund: patch.isRefund === undefined ? false : c.isRefund,
      };
    }
    return {
      ...c,
      transferAccountId: patch.transferAccountId === undefined ? null : c.transferAccountId,
      transferAmount: patch.transferAmount === undefined ? null : c.transferAmount,
    };
  }

  function toData(userId: string, c: Candidate, currency: string) {
    const sameCurrencyTransfer = c.type === 'transfer' && c.transferAmount === null;
    return {
      userId,
      type: c.type,
      accountId: c.accountId,
      categoryId: c.categoryId,
      amount: fromMinor(c.amount),
      currency,
      transferAccountId: c.transferAccountId,
      // Same-currency transfers store the credited amount explicitly so reads never have to infer it.
      transferAmount:
        c.type === 'transfer'
          ? fromMinor(sameCurrencyTransfer ? c.amount : c.transferAmount!)
          : null,
      isRefund: c.isRefund,
      description: c.description,
      merchant: c.merchant,
      date: fromIsoDate(c.date),
      notes: c.notes,
    };
  }

  async function findOwned(userId: string, id: string): Promise<Transaction> {
    const row = await db.transaction.findFirst({ where: { id, userId } });
    if (!row) throw AppError.notFound('That transaction');
    return row;
  }

  function buildWhere(
    userId: string,
    f: TransactionFilter,
    categoryIds?: string[],
  ): Prisma.TransactionWhereInput {
    const and: Prisma.TransactionWhereInput[] = [];
    if (f.q) {
      and.push({
        OR: [
          { description: { contains: f.q, mode: 'insensitive' } },
          { merchant: { contains: f.q, mode: 'insensitive' } },
          { notes: { contains: f.q, mode: 'insensitive' } },
          { category: { name: { contains: f.q, mode: 'insensitive' } } },
        ],
      });
    }
    if (f.accountId)
      and.push({ OR: [{ accountId: f.accountId }, { transferAccountId: f.accountId }] });
    if (categoryIds) and.push({ categoryId: { in: categoryIds } });
    if (f.uncategorized) and.push({ categoryId: null, type: { not: 'transfer' } });
    return {
      userId,
      ...(f.type ? { type: f.type } : {}),
      ...(f.dateFrom || f.dateTo
        ? {
            date: {
              ...(f.dateFrom ? { gte: fromIsoDate(f.dateFrom) } : {}),
              ...(f.dateTo ? { lte: fromIsoDate(f.dateTo) } : {}),
            },
          }
        : {}),
      ...(f.amountMin !== undefined || f.amountMax !== undefined
        ? {
            amount: {
              ...(f.amountMin !== undefined ? { gte: fromMinor(f.amountMin) } : {}),
              ...(f.amountMax !== undefined ? { lte: fromMinor(f.amountMax) } : {}),
            },
          }
        : {}),
      ...(and.length > 0 ? { AND: and } : {}),
    };
  }

  return {
    /** `meta` is set only when a recurring payment is recorded or a row is imported. */
    async create(
      userId: string,
      input: CreateTransactionInput,
      meta: { recurringTransactionId?: string; importHash?: string } = {},
    ): Promise<TransactionDto> {
      const candidate: Candidate = {
        type: input.type,
        accountId: input.accountId,
        categoryId: input.categoryId ?? null,
        amount: input.amount,
        description: input.description,
        merchant: input.merchant ?? null,
        date: input.date,
        notes: input.notes ?? null,
        transferAccountId: input.transferAccountId ?? null,
        transferAmount: input.transferAmount ?? null,
        isRefund: input.isRefund,
      };
      const { currency } = await validate(userId, candidate);
      const deltas = mergeDeltas(
        ledgerEffects({
          type: candidate.type,
          accountId: candidate.accountId,
          amount: candidate.amount,
          transferAccountId: candidate.transferAccountId,
          transferAmount: candidate.transferAmount,
        }),
      );
      const created = await db.$transaction(async (tx) => {
        const row = await tx.transaction.create({
          data: {
            ...toData(userId, candidate, currency),
            ...(meta.recurringTransactionId
              ? { isRecurring: true, recurringTransactionId: meta.recurringTransactionId }
              : {}),
            ...(meta.importHash ? { importHash: meta.importHash } : {}),
          },
        });
        await applyDeltas(tx, userId, deltas);
        return row;
      });
      return toTransactionDto(created);
    },

    async update(
      userId: string,
      id: string,
      patch: UpdateTransactionInput,
    ): Promise<TransactionDto> {
      const existing = await findOwned(userId, id);
      const candidate = dropInherited(
        {
          type: patch.type ?? existing.type,
          accountId: patch.accountId ?? existing.accountId,
          categoryId: patch.categoryId !== undefined ? patch.categoryId : existing.categoryId,
          amount: patch.amount ?? toMinor(existing.amount),
          description: patch.description ?? existing.description,
          merchant: patch.merchant !== undefined ? patch.merchant : existing.merchant,
          date: patch.date ?? toIsoDate(existing.date),
          notes: patch.notes !== undefined ? patch.notes : existing.notes,
          transferAccountId:
            patch.transferAccountId !== undefined
              ? patch.transferAccountId
              : existing.transferAccountId,
          // A changed amount invalidates an old FX credit unless the caller restates it.
          transferAmount:
            patch.transferAmount !== undefined
              ? patch.transferAmount
              : patch.amount !== undefined || patch.accountId || patch.transferAccountId
                ? null
                : toMinorOrNull(existing.transferAmount),
          isRefund: patch.isRefund ?? existing.isRefund,
        },
        patch,
      );
      const { currency } = await validate(userId, candidate, existing);
      const after: LedgerTx = {
        type: candidate.type,
        accountId: candidate.accountId,
        amount: candidate.amount,
        transferAccountId: candidate.transferAccountId,
        transferAmount:
          candidate.type === 'transfer' ? (candidate.transferAmount ?? candidate.amount) : null,
      };
      const deltas = editEffects(asLedger(existing), after);
      const updated = await db.$transaction(async (tx) => {
        const row = await tx.transaction.update({
          where: { id },
          data: toData(userId, candidate, currency),
        });
        await applyDeltas(tx, userId, deltas);
        return row;
      });
      return toTransactionDto(updated);
    },

    async remove(userId: string, id: string): Promise<void> {
      const existing = await findOwned(userId, id);
      const deltas = deleteEffects(asLedger(existing));
      await db.$transaction(async (tx) => {
        await tx.transaction.delete({ where: { id } });
        await applyDeltas(tx, userId, deltas);
      });
    },

    async removeMany(userId: string, ids: string[]): Promise<number> {
      const unique = [...new Set(ids)];
      const rows = await db.transaction.findMany({ where: { userId, id: { in: unique } } });
      if (rows.length !== unique.length) throw AppError.notFound('One of those transactions');
      const deltas = mergeDeltas(rows.flatMap((r) => deleteEffects(asLedger(r))));
      await db.$transaction(async (tx) => {
        await tx.transaction.deleteMany({ where: { userId, id: { in: unique } } });
        await applyDeltas(tx, userId, deltas);
      });
      return rows.length;
    },

    async get(userId: string, id: string): Promise<TransactionDto> {
      return toTransactionDto(await findOwned(userId, id));
    },

    async list(userId: string, filter: TransactionFilter): Promise<TransactionListDto> {
      let categoryIds: string[] | undefined;
      if (filter.categoryId) {
        const category = await db.category.findFirst({ where: { id: filter.categoryId, userId } });
        if (!category) return { items: [], total: 0, page: filter.page, pageSize: filter.pageSize };
        const children = await db.category.findMany({
          where: { userId, parentId: category.id },
          select: { id: true },
        });
        categoryIds = [category.id, ...children.map((c) => c.id)];
      }
      const where = buildWhere(userId, filter, categoryIds);
      const dir = filter.dir;
      const orderBy: Prisma.TransactionOrderByWithRelationInput[] =
        filter.sort === 'amount'
          ? [{ amount: dir }, { date: 'desc' }, { id: 'desc' }]
          : [{ date: dir }, { createdAt: dir }, { id: dir }];
      const [total, rows] = await Promise.all([
        db.transaction.count({ where }),
        db.transaction.findMany({
          where,
          orderBy,
          skip: (filter.page - 1) * filter.pageSize,
          take: filter.pageSize,
        }),
      ]);
      return {
        items: rows.map(toTransactionDto),
        total,
        page: filter.page,
        pageSize: filter.pageSize,
      };
    },

    /** Assigns one category to many transactions, refusing combinations that break the rules. */
    async bulkCategorize(
      userId: string,
      ids: string[],
      categoryId: string | null,
    ): Promise<number> {
      const unique = [...new Set(ids)];
      const rows = await db.transaction.findMany({ where: { userId, id: { in: unique } } });
      if (rows.length !== unique.length) throw AppError.notFound('One of those transactions');
      if (categoryId) {
        const category = await db.category.findFirst({ where: { id: categoryId, userId } });
        if (!category)
          throw AppError.badRequest('Choose one of your categories.', 'validation_failed', {
            categoryId: ['Choose one of your categories.'],
          });
        if (category.isArchived) {
          throw AppError.badRequest(
            'That category is archived. Pick another.',
            'category_archived',
          );
        }
        const incompatible = rows.filter((r) =>
          r.type === 'transfer'
            ? true
            : r.isRefund
              ? category.type !== 'expense'
              : r.type !== category.type,
        );
        if (incompatible.length > 0) {
          throw AppError.badRequest(
            `${incompatible.length} of the selected transactions can't use "${category.name}" (transfers have no category, and income and expenses need their own kind).`,
            'category_mismatch',
          );
        }
      }
      const { count } = await db.transaction.updateMany({
        where: { userId, id: { in: unique }, type: { not: 'transfer' } },
        data: { categoryId },
      });
      return count;
    },

    /** Most-used (account, category, description) combinations in the last 90 days, for one-tap repeat entry. */
    async suggestions(userId: string, today: Date = new Date()): Promise<SuggestionsDto> {
      const since = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);
      const groups = await db.transaction.groupBy({
        by: ['type', 'accountId', 'categoryId', 'description', 'merchant'],
        where: { userId, type: { not: 'transfer' }, date: { gte: since } },
        _count: { _all: true },
        orderBy: { _count: { id: 'desc' } },
        take: 6,
      });
      return {
        suggestions: groups.map((g) => ({
          type: g.type,
          accountId: g.accountId,
          categoryId: g.categoryId,
          description: g.description,
          merchant: g.merchant,
          count: g._count._all,
        })),
      };
    },
  };
}

export type TransactionsService = ReturnType<typeof createTransactionsService>;
