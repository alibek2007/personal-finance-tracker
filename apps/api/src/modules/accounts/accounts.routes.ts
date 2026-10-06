import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  accountListSchema,
  accountSchema,
  balanceHistorySchema,
  createAccountSchema,
  idSchema,
  updateAccountSchema,
} from '@pfm/validation';
import { createAccountsService } from './accounts.service';

const params = z.object({ id: idSchema });
const okSchema = z.object({ ok: z.literal(true) });

export const accountsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', app.requireUser);
  const service = createAccountsService(app.db);
  const uid = (request: { auth?: { userId: string } }) => request.auth!.userId;

  app.get(
    '/accounts',
    {
      schema: {
        tags: ['accounts'],
        querystring: z.object({ includeArchived: z.enum(['true', 'false']).optional() }),
        response: { 200: accountListSchema },
      },
    },
    async (request) => service.list(uid(request), request.query.includeArchived === 'true'),
  );

  app.post(
    '/accounts',
    { schema: { tags: ['accounts'], body: createAccountSchema, response: { 201: accountSchema } } },
    async (request, reply) =>
      reply.status(201).send(await service.create(uid(request), request.body)),
  );

  // Static path registered before "/:id" so "reconcile" is never read as an id.
  app.post(
    '/accounts/reconcile',
    {
      schema: {
        tags: ['accounts'],
        description: 'Checks every cached balance against opening balance + transactions.',
        response: {
          200: z.object({
            drift: z.array(
              z.object({
                accountId: z.string(),
                name: z.string(),
                stored: z.number(),
                expected: z.number(),
              }),
            ),
          }),
        },
      },
    },
    async (request) => ({ drift: await service.reconcile(uid(request)) }),
  );

  app.get(
    '/accounts/:id',
    { schema: { tags: ['accounts'], params, response: { 200: accountSchema } } },
    async (request) => service.get(uid(request), request.params.id),
  );

  app.patch(
    '/accounts/:id',
    {
      schema: {
        tags: ['accounts'],
        params,
        body: updateAccountSchema,
        response: { 200: accountSchema },
      },
    },
    async (request) => service.update(uid(request), request.params.id, request.body),
  );

  app.delete(
    '/accounts/:id',
    { schema: { tags: ['accounts'], params, response: { 200: okSchema } } },
    async (request) => {
      await service.remove(uid(request), request.params.id);
      return { ok: true as const };
    },
  );

  app.get(
    '/accounts/:id/balance-history',
    { schema: { tags: ['accounts'], params, response: { 200: balanceHistorySchema } } },
    async (request) => service.balanceHistory(uid(request), request.params.id),
  );
};
