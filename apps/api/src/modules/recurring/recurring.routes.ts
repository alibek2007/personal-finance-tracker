import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  createRecurringSchema,
  idSchema,
  occurrenceListSchema,
  occurrenceQuerySchema,
  recurringListSchema,
  recurringSchema,
  updateRecurringSchema,
} from '@pfm/validation';

const params = z.object({ id: idSchema });

export const recurringRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', app.requireUser);
  const service = app.recurring;
  const uid = (request: { auth?: { userId: string } }) => request.auth!.userId;

  app.get(
    '/recurring',
    {
      schema: {
        tags: ['recurring'],
        description:
          'Recurring payments with their monthly and yearly cost. Records anything that has come due first.',
        response: { 200: recurringListSchema },
      },
    },
    async (request) => {
      await service.materialize(uid(request));
      return service.list(uid(request));
    },
  );

  app.post(
    '/recurring',
    {
      schema: {
        tags: ['recurring'],
        body: createRecurringSchema,
        response: { 201: recurringSchema },
      },
    },
    async (request, reply) =>
      reply.status(201).send(await service.create(uid(request), request.body)),
  );

  app.post(
    '/recurring/run',
    {
      schema: {
        tags: ['recurring'],
        description: 'Records any payments that have come due. Idempotent.',
        response: { 200: z.object({ created: z.number().int() }) },
      },
    },
    async (request) => service.materialize(uid(request)),
  );

  app.get(
    '/recurring/occurrences',
    {
      schema: {
        tags: ['recurring'],
        querystring: occurrenceQuerySchema,
        description:
          'Payments still to come within a date range (for "coming up" and the calendar).',
        response: { 200: occurrenceListSchema },
      },
    },
    async (request) => ({
      occurrences: await service.occurrences(uid(request), request.query.from, request.query.to),
    }),
  );

  app.patch(
    '/recurring/:id',
    {
      schema: {
        tags: ['recurring'],
        params,
        body: updateRecurringSchema,
        response: { 200: recurringSchema },
      },
    },
    async (request) => service.update(uid(request), request.params.id, request.body),
  );

  app.delete(
    '/recurring/:id',
    {
      schema: { tags: ['recurring'], params, response: { 200: z.object({ ok: z.literal(true) }) } },
    },
    async (request) => {
      await service.remove(uid(request), request.params.id);
      return { ok: true as const };
    },
  );
};
