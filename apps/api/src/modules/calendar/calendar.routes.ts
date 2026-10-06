import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { calendarQuerySchema, calendarSchema } from '@pfm/validation';
import { createCalendarService } from './calendar.service';

export const calendarRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', app.requireUser);
  const service = createCalendarService(app.db, app.now, app.recurring);

  app.get(
    '/calendar',
    {
      schema: {
        tags: ['calendar'],
        description:
          'Transactions, upcoming recurring payments and goal deadlines for a date range (62 days at most).',
        querystring: calendarQuerySchema,
        response: { 200: calendarSchema },
      },
    },
    async (request) => {
      const userId = request.auth!.userId;
      await app.recurring.materialize(userId);
      return service.range(userId, request.query.from, request.query.to);
    },
  );
};
