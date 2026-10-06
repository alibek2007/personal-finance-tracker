import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  analyticsQuerySchema,
  balancesSchema,
  budgetPerformanceSchema,
  cashFlowSchema,
  categoryBreakdownSchema,
  monthlyQuerySchema,
  monthlySchema,
  overviewSchema,
  savingsProgressSchema,
  spendingTrendSchema,
  summarySchema,
} from '@pfm/validation';
import { createBudgetsService } from '../budgets/budgets.service';
import { createAnalyticsService } from './analytics.service';

export const analyticsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', app.requireUser);
  const service = createAnalyticsService(app.db, app.now);
  const budgets = createBudgetsService(app.db, app.now);
  const uid = (request: { auth?: { userId: string } }) => request.auth!.userId;

  app.get(
    '/analytics/overview',
    {
      schema: {
        tags: ['analytics'],
        description: 'This month so far versus the same days of last month, plus insights.',
        response: { 200: overviewSchema },
      },
    },
    async (request) => {
      await app.recurring.materialize(uid(request)); // so the dashboard never shows a due payment as missing
      return service.overview(uid(request));
    },
  );

  app.get(
    '/analytics/cash-flow',
    {
      schema: {
        tags: ['analytics'],
        querystring: analyticsQuerySchema,
        response: { 200: cashFlowSchema },
      },
    },
    async (request) => service.cashFlow(uid(request), request.query),
  );

  app.get(
    '/analytics/categories',
    {
      schema: {
        tags: ['analytics'],
        querystring: analyticsQuerySchema,
        response: { 200: categoryBreakdownSchema },
      },
    },
    async (request) => service.categories(uid(request), request.query),
  );

  const q = { querystring: analyticsQuerySchema };

  app.get(
    '/analytics/summary',
    {
      schema: {
        tags: ['analytics'],
        ...q,
        description: 'Totals for a range versus the equal period before it.',
        response: { 200: summarySchema },
      },
    },
    async (request) => service.summary(uid(request), request.query),
  );

  app.get(
    '/analytics/spending-trend',
    {
      schema: {
        tags: ['analytics'],
        ...q,
        description: 'Spending per period split by the biggest categories.',
        response: { 200: spendingTrendSchema },
      },
    },
    async (request) => service.spendingTrend(uid(request), request.query),
  );

  app.get(
    '/analytics/monthly',
    {
      schema: {
        tags: ['analytics'],
        querystring: monthlyQuerySchema,
        description: 'Calendar months side by side with change versus the month before.',
        response: { 200: monthlySchema },
      },
    },
    async (request) => service.monthly(uid(request), request.query),
  );

  app.get(
    '/analytics/balances',
    {
      schema: {
        tags: ['analytics'],
        ...q,
        description: 'Net worth and per-account balances over time.',
        response: { 200: balancesSchema },
      },
    },
    async (request) => service.balances(uid(request), request.query),
  );

  app.get(
    '/analytics/savings',
    {
      schema: {
        tags: ['analytics'],
        ...q,
        description: 'Money set aside for goals over time, and each goal’s standing.',
        response: { 200: savingsProgressSchema },
      },
    },
    async (request) => service.savings(uid(request), request.query),
  );

  app.get(
    '/analytics/budget-performance',
    {
      schema: {
        tags: ['analytics'],
        description: 'How each monthly budget fared over the last six months.',
        response: { 200: budgetPerformanceSchema },
      },
    },
    async (request) => budgets.performance(uid(request), 6),
  );
};
