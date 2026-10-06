import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  categoryListSchema,
  categorySchema,
  createCategorySchema,
  idSchema,
  updateCategorySchema,
} from '@pfm/validation';
import { createCategoriesService } from './categories.service';

const params = z.object({ id: idSchema });

export const categoriesRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', app.requireUser);
  const service = createCategoriesService(app.db);
  const uid = (request: { auth?: { userId: string } }) => request.auth!.userId;

  app.get(
    '/categories',
    {
      schema: {
        tags: ['categories'],
        querystring: z.object({ includeArchived: z.enum(['true', 'false']).optional() }),
        response: { 200: categoryListSchema },
      },
    },
    async (request) => ({
      categories: await service.list(uid(request), request.query.includeArchived === 'true'),
    }),
  );

  app.post(
    '/categories',
    {
      schema: {
        tags: ['categories'],
        body: createCategorySchema,
        response: { 201: categorySchema },
      },
    },
    async (request, reply) =>
      reply.status(201).send(await service.create(uid(request), request.body)),
  );

  app.patch(
    '/categories/:id',
    {
      schema: {
        tags: ['categories'],
        params,
        body: updateCategorySchema,
        response: { 200: categorySchema },
      },
    },
    async (request) => service.update(uid(request), request.params.id, request.body),
  );

  app.delete(
    '/categories/:id',
    {
      schema: {
        tags: ['categories'],
        params,
        querystring: z.object({ reassignTo: idSchema.optional() }),
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (request) => {
      await service.remove(uid(request), request.params.id, request.query.reassignTo);
      return { ok: true as const };
    },
  );
};
