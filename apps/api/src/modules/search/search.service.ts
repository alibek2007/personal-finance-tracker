import {
  CURRENCIES,
  ruleBasedInterpreter,
  todayInZone,
  currencyExponent,
  type CurrencyCode,
  type SearchInterpreter,
} from '@pfm/finance';
import type { SearchResultDto, TransactionFilter } from '@pfm/validation';
import type { Db } from '../../lib/db';
import { toMinor } from '../../lib/convert';
import { AppError } from '../../utils/errors';
import type { createTransactionsService } from '../transactions/transactions.service';

const SHOWN = 6;

/**
 * Global search. The query goes through a `SearchInterpreter` that turns words into structured filters;
 * swapping in a smarter (e.g. language-model) interpreter changes nothing else here.
 */
export function createSearchService(
  db: Db,
  now: () => Date,
  transactions: ReturnType<typeof createTransactionsService>,
  interpreter: SearchInterpreter = ruleBasedInterpreter,
) {
  return {
    async search(userId: string, q: string): Promise<SearchResultDto> {
      const user = await db.user.findUnique({ where: { id: userId } });
      if (!user) throw AppError.unauthorized();
      const currency = user.currency as CurrencyCode;
      const categories = await db.category.findMany({ where: { userId, isArchived: false } });

      const interpreted = interpreter.interpret(q, {
        today: todayInZone(now(), user.timezone),
        minorPerMajor: 10 ** currencyExponent(currency),
        currencySymbol: CURRENCIES[currency].symbol,
        categories: categories.map((c) => ({ id: c.id, name: c.name })),
      });

      const filter = {
        sort: 'date',
        dir: 'desc',
        page: 1,
        pageSize: SHOWN,
        ...(interpreted.text ? { q: interpreted.text } : {}),
        ...(interpreted.type ? { type: interpreted.type } : {}),
        ...(interpreted.amountMin !== undefined ? { amountMin: interpreted.amountMin } : {}),
        ...(interpreted.amountMax !== undefined ? { amountMax: interpreted.amountMax } : {}),
        ...(interpreted.dateFrom ? { dateFrom: interpreted.dateFrom } : {}),
        ...(interpreted.dateTo ? { dateTo: interpreted.dateTo } : {}),
        ...(interpreted.categoryIds[0] ? { categoryId: interpreted.categoryIds[0] } : {}),
      } as TransactionFilter;

      // Accounts, goals and the like are matched on the words themselves. A bare category word ("rent") is
      // also a category filter for transactions, but must still find a goal or bill with that name.
      const structured =
        interpreted.type !== undefined ||
        interpreted.amountMin !== undefined ||
        interpreted.amountMax !== undefined ||
        interpreted.dateFrom !== undefined;
      const text = structured ? interpreted.text : q.trim();
      const contains = { contains: text, mode: 'insensitive' as const };
      const [found, accounts, goals, recurring] = await Promise.all([
        transactions.list(userId, filter),
        text
          ? db.account.findMany({
              where: { userId, OR: [{ name: contains }, { institution: contains }] },
              take: SHOWN,
              orderBy: { name: 'asc' },
            })
          : [],
        text
          ? db.savingsGoal.findMany({
              where: { userId, name: contains },
              take: SHOWN,
              orderBy: { name: 'asc' },
            })
          : [],
        text
          ? db.recurringTransaction.findMany({
              where: { userId, description: contains },
              take: SHOWN,
              orderBy: { description: 'asc' },
            })
          : [],
      ]);

      const byId = new Map(categories.map((c) => [c.id, c]));
      const matchingCategories = text
        ? categories
            .filter((c) => c.name.toLowerCase().includes(text.toLowerCase()))
            .slice(0, SHOWN)
        : [];

      // The filter as the transactions screen understands it (query-string values), for "see all".
      const transactionFilter: Record<string, string> = {};
      for (const [key, value] of Object.entries(filter)) {
        if (['sort', 'dir', 'page', 'pageSize'].includes(key)) continue;
        transactionFilter[key] = String(value);
      }

      return {
        query: q,
        understood: interpreted.understood,
        transactionFilter,
        transactions: {
          total: found.total,
          items: found.items.map((t) => ({
            ...t,
            categoryName: t.categoryId ? (byId.get(t.categoryId)?.name ?? null) : null,
          })),
        },
        accounts: accounts.map((a) => ({
          id: a.id,
          name: a.name,
          currency: a.currency as CurrencyCode,
          balance: toMinor(a.currentBalance),
          isArchived: a.isArchived,
        })),
        categories: matchingCategories.map((c) => ({
          id: c.id,
          name: c.name,
          parentName: c.parentId ? (byId.get(c.parentId)?.name ?? null) : null,
        })),
        goals: goals.map((g) => ({ id: g.id, name: g.name })),
        recurring: recurring.map((r) => ({
          id: r.id,
          description: r.description,
          amount: toMinor(r.amount),
          currency: r.currency as CurrencyCode,
        })),
      };
    },
  };
}
