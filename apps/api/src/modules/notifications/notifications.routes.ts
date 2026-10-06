import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  idSchema,
  notificationListSchema,
  notificationQuerySchema,
  notificationSchema,
  unreadCountSchema,
} from '@pfm/validation';
import { createBudgetsService } from '../budgets/budgets.service';
import { createGoalsService } from '../goals/goals.service';
import { createNotificationsService } from './notifications.service';

const params = z.object({ id: idSchema });

export const notificationsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', app.requireUser);
  const service = createNotificationsService(app.db, app.now, {
    budgets: createBudgetsService(app.db, app.now),
    goals: createGoalsService(app.db, app.now),
  });
  const uid = (request: { auth?: { userId: string } }) => request.auth!.userId;
  /** Bills come due and budgets fill up with no request involved: catch up whenever someone looks. */
  const fresh = async (userId: string) => {
    await app.recurring.materialize(userId);
    await service.sync(userId);
  };

  app.get(
    '/notifications',
    {
      schema: {
        tags: ['notifications'],
        querystring: notificationQuerySchema,
        response: { 200: notificationListSchema },
      },
    },
    async (request) => {
      await fresh(uid(request));
      return service.list(uid(request), request.query);
    },
  );

  app.get(
    '/notifications/unread-count',
    { schema: { tags: ['notifications'], response: { 200: unreadCountSchema } } },
    async (request) => {
      await fresh(uid(request));
      return { unreadCount: await service.unreadCount(uid(request)) };
    },
  );

  app.post(
    '/notifications/read-all',
    { schema: { tags: ['notifications'], response: { 200: unreadCountSchema } } },
    async (request) => {
      await fresh(uid(request)); // so "all" includes what has come up since the last look
      await service.markAllRead(uid(request));
      return { unreadCount: 0 };
    },
  );

  app.patch(
    '/notifications/:id',
    {
      schema: {
        tags: ['notifications'],
        params,
        body: z.object({ isRead: z.boolean() }),
        response: { 200: notificationSchema },
      },
    },
    async (request) => service.setRead(uid(request), request.params.id, request.body.isRead),
  );
};
