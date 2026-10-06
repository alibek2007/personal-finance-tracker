import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  bulkCategorizeSchema,
  bulkDeleteSchema,
  createTransactionSchema,
  idSchema,
  suggestionSchema,
  transactionFilterSchema,
  transactionListSchema,
  transactionSchema,
  updateTransactionSchema,
} from '@pfm/validation';
import { createTransactionsService } from './transactions.service';

const params = z.object({ id: idSchema });
const countSchema = z.object({ count: z.number().int() });

export const transactionsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', app.requireUser);
  const service = createTransactionsService(app.db);
  const uid = (request: { auth?: { userId: string } }) => request.auth!.userId;

  app.get(
    '/transactions',
    {
      schema: {
        tags: ['transactions'],
        querystring: transactionFilterSchema,
        response: { 200: transactionListSchema },
      },
    },
    async (request) => service.list(uid(request), request.query),
  );

  app.post(
    '/transactions',
    {
      schema: {
        tags: ['transactions'],
        body: createTransactionSchema,
        response: { 201: transactionSchema },
      },
    },
    async (request, reply) =>
      reply.status(201).send(await service.create(uid(request), request.body)),
  );

  app.get(
    '/transactions/suggestions',
    { schema: { tags: ['transactions'], response: { 200: suggestionSchema } } },
    async (request) => service.suggestions(uid(request)),
  );

  app.post(
    '/transactions/bulk-categorize',
    {
      schema: {
        tags: ['transactions'],
        body: bulkCategorizeSchema,
        response: { 200: countSchema },
      },
    },
    async (request) => ({
      count: await service.bulkCategorize(uid(request), request.body.ids, request.body.categoryId),
    }),
  );

  app.post(
    '/transactions/bulk-delete',
    { schema: { tags: ['transactions'], body: bulkDeleteSchema, response: { 200: countSchema } } },
    async (request) => ({ count: await service.removeMany(uid(request), request.body.ids) }),
  );

  app.get(
    '/transactions/:id',
    { schema: { tags: ['transactions'], params, response: { 200: transactionSchema } } },
    async (request) => service.get(uid(request), request.params.id),
  );

  app.patch(
    '/transactions/:id',
    {
      schema: {
        tags: ['transactions'],
        params,
        body: updateTransactionSchema,
        response: { 200: transactionSchema },
      },
    },
    async (request) => service.update(uid(request), request.params.id, request.body),
  );

  app.delete(
    '/transactions/:id',
    {
      schema: {
        tags: ['transactions'],
        params,
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (request) => {
      await service.remove(uid(request), request.params.id);
      return { ok: true as const };
    },
  );
};
