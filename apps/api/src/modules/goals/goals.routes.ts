import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  contributionSchema,
  createGoalSchema,
  goalDetailSchema,
  goalListSchema,
  goalSchema,
  idSchema,
  updateGoalSchema,
} from '@pfm/validation';
import { createGoalsService } from './goals.service';

const params = z.object({ id: idSchema });
const contributionParams = z.object({ id: idSchema, contributionId: idSchema });

export const goalsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', app.requireUser);
  const service = createGoalsService(app.db, app.now);
  const uid = (request: { auth?: { userId: string } }) => request.auth!.userId;

  app.get(
    '/goals',
    {
      schema: {
        tags: ['goals'],
        querystring: z.object({ includeArchived: z.enum(['true', 'false']).optional() }),
        response: { 200: goalListSchema },
      },
    },
    async (request) => service.list(uid(request), request.query.includeArchived === 'true'),
  );

  app.post(
    '/goals',
    { schema: { tags: ['goals'], body: createGoalSchema, response: { 201: goalSchema } } },
    async (request, reply) =>
      reply.status(201).send(await service.create(uid(request), request.body)),
  );

  app.post(
    '/goals/reconcile',
    {
      schema: {
        tags: ['goals'],
        description: 'Checks every goal total against the sum of its contributions.',
        response: {
          200: z.object({
            drift: z.array(
              z.object({
                goalId: z.string(),
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
    '/goals/:id',
    { schema: { tags: ['goals'], params, response: { 200: goalDetailSchema } } },
    async (request) => service.get(uid(request), request.params.id),
  );

  app.patch(
    '/goals/:id',
    { schema: { tags: ['goals'], params, body: updateGoalSchema, response: { 200: goalSchema } } },
    async (request) => service.update(uid(request), request.params.id, request.body),
  );

  app.delete(
    '/goals/:id',
    { schema: { tags: ['goals'], params, response: { 200: z.object({ ok: z.literal(true) }) } } },
    async (request) => {
      await service.remove(uid(request), request.params.id);
      return { ok: true as const };
    },
  );

  app.post(
    '/goals/:id/contributions',
    {
      schema: { tags: ['goals'], params, body: contributionSchema, response: { 201: goalSchema } },
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(await service.addContribution(uid(request), request.params.id, request.body)),
  );

  app.delete(
    '/goals/:id/contributions/:contributionId',
    { schema: { tags: ['goals'], params: contributionParams, response: { 200: goalSchema } } },
    async (request) =>
      service.removeContribution(uid(request), request.params.id, request.params.contributionId),
  );
};
