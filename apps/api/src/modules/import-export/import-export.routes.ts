import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  importPreviewSchema,
  importRequestSchema,
  importResultSchema,
  transactionFilterSchema,
} from '@pfm/validation';
import { createTransactionsService } from '../transactions/transactions.service';
import { createImportExportService } from './import-export.service';

export const importExportRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', app.requireUser);
  const service = createImportExportService(app.db, app.now, createTransactionsService(app.db));
  const uid = (request: { auth?: { userId: string } }) => request.auth!.userId;

  app.get(
    '/export/transactions',
    {
      schema: {
        tags: ['export'],
        description:
          'All transactions matching the filters as a CSV file (paging options are ignored).',
        querystring: transactionFilterSchema,
      },
      // Exports are heavy and sensitive: tighter than the global limit.
      config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
    },
    async (request, reply) => {
      const { csv } = await service.exportCsv(uid(request), request.query, {
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      });
      const stamp = app.now().toISOString().slice(0, 10);
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="ledger-transactions-${stamp}.csv"`)
        .header('cache-control', 'no-store')
        .send(csv);
    },
  );

  app.post(
    '/import/transactions/preview',
    {
      schema: {
        tags: ['import'],
        description: 'Reads a CSV and reports what would happen, without changing anything.',
        body: importRequestSchema,
        response: { 200: importPreviewSchema },
      },
      bodyLimit: 3 * 1024 * 1024,
    },
    async (request) => service.preview(uid(request), request.body),
  );

  app.post(
    '/import/transactions',
    {
      schema: {
        tags: ['import'],
        description:
          'Imports the valid rows of a CSV. Repeating the same file never doubles anything.',
        body: importRequestSchema,
        response: { 200: importResultSchema },
      },
      bodyLimit: 3 * 1024 * 1024,
      config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
    },
    async (request) =>
      service.commit(uid(request), request.body, {
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      }),
  );
};
