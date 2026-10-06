import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { searchQuerySchema, searchResultSchema } from '@pfm/validation';
import { createTransactionsService } from '../transactions/transactions.service';
import { createSearchService } from './search.service';

export const searchRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', app.requireUser);
  const service = createSearchService(app.db, app.now, createTransactionsService(app.db));

  app.get(
    '/search',
    {
      schema: {
        tags: ['search'],
        description:
          'Search transactions, accounts, categories, goals and recurring payments. Understands things like "expenses over $50 last month".',
        querystring: searchQuerySchema,
        response: { 200: searchResultSchema },
      },
    },
    async (request) => service.search(request.auth!.userId, request.query.q),
  );
};
