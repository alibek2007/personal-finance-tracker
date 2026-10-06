import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  // Liveness: process is up. Never touches the database.
  app.get(
    '/health',
    {
      config: { rateLimit: false },
      schema: { tags: ['system'], response: { 200: z.object({ status: z.literal('ok') }) } },
    },
    async () => ({ status: 'ok' as const }),
  );

  // Readiness: can we reach the database?
  app.get(
    '/ready',
    {
      config: { rateLimit: false },
      schema: {
        tags: ['system'],
        response: {
          200: z.object({ status: z.literal('ready') }),
          503: z.object({ status: z.literal('unavailable'), reason: z.string() }),
        },
      },
    },
    async (_request, reply) => {
      try {
        await app.db.$queryRaw`SELECT 1`;
        return { status: 'ready' as const };
      } catch {
        return reply.status(503).send({ status: 'unavailable' as const, reason: 'database' });
      }
    },
  );
};
