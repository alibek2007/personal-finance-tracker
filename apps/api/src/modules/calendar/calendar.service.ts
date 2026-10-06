import { todayInZone, type CurrencyCode } from '@pfm/finance';
import type { CalendarDayDto, CalendarDto } from '@pfm/validation';
import type { Db } from '../../lib/db';
import { fromIsoDate, toIsoDate, toMinor } from '../../lib/convert';
import { AppError } from '../../utils/errors';
import type { RecurringService } from '../recurring/recurring.service';

/** One month view: what happened, what is coming, and which goal deadlines fall where. */
export function createCalendarService(db: Db, now: () => Date, recurring: RecurringService) {
  return {
    async range(userId: string, from: string, to: string): Promise<CalendarDto> {
      const user = await db.user.findUnique({ where: { id: userId } });
      if (!user) throw AppError.unauthorized();
      const currency = user.currency as CurrencyCode;
      const today = todayInZone(now(), user.timezone);

      const [txs, upcoming, goals] = await Promise.all([
        db.transaction.findMany({
          where: { userId, date: { gte: fromIsoDate(from), lte: fromIsoDate(to) } },
          orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
        }),
        recurring.occurrences(userId, from < today ? today : from, to),
        db.savingsGoal.findMany({
          where: {
            userId,
            isArchived: false,
            deadline: { gte: fromIsoDate(from), lte: fromIsoDate(to) },
          },
        }),
      ]);

      const days = new Map<string, CalendarDayDto>();
      const day = (date: string) => {
        let d = days.get(date);
        if (!d) {
          d = {
            date,
            income: 0,
            expense: 0,
            transactions: [],
            upcoming: [],
            goalDeadlines: [],
          };
          days.set(date, d);
        }
        return d;
      };

      for (const t of txs) {
        const d = day(toIsoDate(t.date));
        const amount = toMinor(t.amount);
        d.transactions.push({
          id: t.id,
          type: t.type,
          isRecurring: t.isRecurring,
          description: t.description,
          amount,
          currency: t.currency as CurrencyCode,
        });
        if (t.currency === currency) {
          if (t.type === 'income' && !t.isRefund) d.income += amount;
          else if (t.type === 'income')
            d.expense -= amount; // a refund reduces what you spent
          else if (t.type === 'expense') d.expense += amount;
        }
      }
      for (const o of upcoming) {
        day(o.date).upcoming.push({
          ruleId: o.ruleId,
          type: o.type,
          description: o.description,
          amount: o.amount,
          currency: o.currency,
        });
      }
      for (const g of goals) {
        day(toIsoDate(g.deadline!)).goalDeadlines.push({
          goalId: g.id,
          name: g.name,
          remaining: Math.max(0, toMinor(g.targetAmount) - toMinor(g.currentAmount)),
        });
      }

      return {
        from,
        to,
        today,
        currency,
        days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
      };
    },
  };
}
