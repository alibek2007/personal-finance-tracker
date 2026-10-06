import { z } from 'zod';
import { idSchema } from './common';

export const notificationTypeSchema = z.enum([
  'budget_threshold',
  'budget_exceeded',
  'bill_due',
  'goal_progress',
  'spending_insight',
  'system',
]);

export const notificationSchema = z.object({
  id: idSchema,
  type: notificationTypeSchema,
  title: z.string(),
  message: z.string(),
  isRead: z.boolean(),
  createdAt: z.string(),
  /** Where "take me there" goes in the app. */
  link: z.string().nullable(),
});
export type NotificationDto = z.infer<typeof notificationSchema>;

export const notificationQuerySchema = z.object({
  unread: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const notificationListSchema = z.object({
  items: z.array(notificationSchema),
  unreadCount: z.number().int(),
});
export type NotificationListDto = z.infer<typeof notificationListSchema>;

export const unreadCountSchema = z.object({ unreadCount: z.number().int() });
