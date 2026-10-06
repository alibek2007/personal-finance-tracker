import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  budgetDetailSchema,
  budgetListSchema,
  budgetSchema,
  createBudgetSchema,
  idSchema,
  updateBudgetSchema,
} from '@pfm/validation';
import { createBudgetsService } from './budgets.service';

const params = z.object({ id: idSchema });

export const budgetsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', app.requireUser);
  const service = createBudgetsService(app.db, app.now);
  const uid = (request: { auth?: { userId: string } }) => request.auth!.userId;

  app.get(
    '/budgets',
    {
      schema: {
        tags: ['budgets'],
        description: 'Budgets with this period’s spending, pace and projection.',
        response: { 200: budgetListSchema },
      },
    },
    async (request) => service.list(uid(request)),
  );

  app.post(
    '/budgets',
    { schema: { tags: ['budgets'], body: createBudgetSchema, response: { 201: budgetSchema } } },
    async (request, reply) =>
      reply.status(201).send(await service.create(uid(request), request.body)),
  );

  app.get(
    '/budgets/:id',
    {
      schema: {
        tags: ['budgets'],
        params,
        description: 'One budget plus how it fared in the previous six periods.',
        response: { 200: budgetDetailSchema },
      },
    },
    async (request) => service.get(uid(request), request.params.id),
  );

  app.patch(
    '/budgets/:id',
    {
      schema: {
        tags: ['budgets'],
        params,
        body: updateBudgetSchema,
        response: { 200: budgetSchema },
      },
    },
    async (request) => service.update(uid(request), request.params.id, request.body),
  );

  app.delete(
    '/budgets/:id',
    { schema: { tags: ['budgets'], params, response: { 200: z.object({ ok: z.literal(true) }) } } },
    async (request) => {
      await service.remove(uid(request), request.params.id);
      return { ok: true as const };
    },
  );
};
