import type { Notification } from '@prisma/client';
import { addDays, formatMoney, money, todayInZone, type CurrencyCode } from '@pfm/finance';
import type { NotificationDto } from '@pfm/validation';
import type { Db } from '../../lib/db';
import { fromIsoDate, toIsoDate, toMinor } from '../../lib/convert';
import { AppError } from '../../utils/errors';
import type { createBudgetsService } from '../budgets/budgets.service';
import type { createGoalsService } from '../goals/goals.service';

/** A bill is announced this many days ahead (and not before). */
export const BILL_NOTICE_DAYS = 3;

const LINKS: Record<string, string> = {
  budget_threshold: '/budgets',
  budget_exceeded: '/budgets',
  bill_due: '/recurring',
  goal_progress: '/goals',
};

/** "Oct 8": a calendar date has no timezone, so format it in UTC to avoid shifting a day. */
const shortDate = (iso: string, locale: string) =>
  new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${iso}T00:00:00Z`),
  );

const toDto = (n: Notification): NotificationDto => ({
  id: n.id,
  type: n.type,
  title: n.title,
  message: n.message,
  isRead: n.isRead,
  createdAt: n.createdAt.toISOString(),
  link: LINKS[n.type] ?? null,
});

interface Draft {
  type: Notification['type'];
  title: string;
  message: string;
  dedupeKey: string;
}

/**
 * Notifications are derived from the data (budgets, bills, goals), never typed in. Each condition has a
 * dedupe key, so it fires once per period however often `sync` runs, and reading a notification never
 * brings it back.
 */
export function createNotificationsService(
  db: Db,
  now: () => Date,
  deps: {
    budgets: ReturnType<typeof createBudgetsService>;
    goals: ReturnType<typeof createGoalsService>;
  },
) {
  async function sync(userId: string): Promise<number> {
    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) throw AppError.unauthorized();
    const today = todayInZone(now(), user.timezone);
    const fmt = (minor: number, currency: string) =>
      formatMoney(money(minor, currency as CurrencyCode), { locale: user.locale });
    const drafts: Draft[] = [];

    const { budgets } = await deps.budgets.list(userId);
    for (const b of budgets) {
      if (b.lifecycle !== 'active') continue;
      const name = b.parentCategoryName
        ? `${b.parentCategoryName} › ${b.categoryName}`
        : b.categoryName;
      if (b.status === 'over') {
        drafts.push({
          type: 'budget_exceeded',
          title: `${name} budget exceeded`,
          message: `You've spent ${fmt(b.spent, b.currency)} of ${fmt(b.amount, b.currency)}, ${fmt(b.spent - b.amount, b.currency)} over.`,
          dedupeKey: `budget:${b.id}:${b.periodFrom}:over`,
        });
      } else if (b.usedBp >= b.alertThreshold * 100) {
        drafts.push({
          type: 'budget_threshold',
          title: `${name} budget at ${Math.floor(b.usedBp / 100)}%`,
          message: `${fmt(b.remaining, b.currency)} left until ${shortDate(b.periodTo, user.locale)}.`,
          dedupeKey: `budget:${b.id}:${b.periodFrom}:threshold`,
        });
      }
    }

    const until = addDays(today, BILL_NOTICE_DAYS);
    const bills = await db.recurringTransaction.findMany({
      where: {
        userId,
        isActive: true,
        type: 'expense',
        nextOccurrence: { gte: fromIsoDate(today), lte: fromIsoDate(until) },
      },
    });
    for (const r of bills) {
      const date = toIsoDate(r.nextOccurrence);
      const when =
        date === today
          ? 'today'
          : date === addDays(today, 1)
            ? 'tomorrow'
            : `on ${shortDate(date, user.locale)}`;
      drafts.push({
        type: 'bill_due',
        title: `${r.description} is due ${when}`,
        message: `${fmt(toMinor(r.amount), r.currency)} will be recorded ${when}.`,
        dedupeKey: `bill:${r.id}:${date}`,
      });
    }

    const { goals } = await deps.goals.list(userId, false);
    for (const g of goals) {
      if (g.reached) {
        drafts.push({
          type: 'goal_progress',
          title: `${g.name} reached`,
          message: `You saved ${fmt(g.currentAmount, g.currency)}. Well done.`,
          dedupeKey: `goal:${g.id}:reached`,
        });
      }
    }

    if (drafts.length === 0) return 0;
    const result = await db.notification.createMany({
      data: drafts.map((d) => ({ ...d, userId })),
      skipDuplicates: true,
    });
    return result.count;
  }

  async function unreadCount(userId: string) {
    return db.notification.count({ where: { userId, isRead: false } });
  }

  return {
    sync,
    unreadCount,

    async list(userId: string, opts: { unread?: boolean | undefined; limit: number }) {
      const rows = await db.notification.findMany({
        where: { userId, ...(opts.unread ? { isRead: false } : {}) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: opts.limit,
      });
      return { items: rows.map(toDto), unreadCount: await unreadCount(userId) };
    },

    async setRead(userId: string, id: string, isRead: boolean): Promise<NotificationDto> {
      const existing = await db.notification.findFirst({ where: { id, userId } });
      if (!existing) throw AppError.notFound('That notification');
      return toDto(await db.notification.update({ where: { id }, data: { isRead } }));
    },

    async markAllRead(userId: string): Promise<number> {
      const res = await db.notification.updateMany({
        where: { userId, isRead: false },
        data: { isRead: true },
      });
      return res.count;
    },
  };
}
export type NotificationsService = ReturnType<typeof createNotificationsService>;
