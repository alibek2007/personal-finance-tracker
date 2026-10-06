import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import type { Env } from './config/env';
import type { Db } from './lib/db';
import { AppError } from './utils/errors';
import { createSessionService, SESSION_COOKIE } from './modules/auth/session.service';
import { healthRoutes } from './routes/health';
import { ConsoleMailer, type Mailer } from './lib/mailer';
import { createAuthTokenService } from './modules/auth/auth-token.service';
import { createAuthService, type AuthService } from './modules/auth/auth.service';
import { authRoutes } from './modules/auth/auth.routes';
import { accountsRoutes } from './modules/accounts/accounts.routes';
import { categoriesRoutes } from './modules/categories/categories.routes';
import { transactionsRoutes } from './modules/transactions/transactions.routes';
import { analyticsRoutes } from './modules/analytics/analytics.routes';
import { budgetsRoutes } from './modules/budgets/budgets.routes';
import { goalsRoutes } from './modules/goals/goals.routes';
import { calendarRoutes } from './modules/calendar/calendar.routes';
import { importExportRoutes } from './modules/import-export/import-export.routes';
import { searchRoutes } from './modules/search/search.routes';
import { notificationsRoutes } from './modules/notifications/notifications.routes';
import { recurringRoutes } from './modules/recurring/recurring.routes';
import {
  createRecurringService,
  type RecurringService,
} from './modules/recurring/recurring.service';
import { createTransactionsService } from './modules/transactions/transactions.service';

export interface BuildAppOptions {
  env: Env;
  db: Db;
  /** Defaults to a console transport that logs emails (development). */
  mailer?: Mailer;
  /** Injected clock so date-dependent reports are deterministic in tests. Defaults to the real time. */
  now?: () => Date;
}

declare module 'fastify' {
  interface FastifyInstance {
    env: Env;
    db: Db;
    sessions: ReturnType<typeof createSessionService>;
    auth: AuthService;
    mailer: Mailer;
    now: () => Date;
    recurring: RecurringService;
    /** preHandler: 401 unless a valid session cookie is present. Populates request.auth. */
    requireUser: (request: FastifyRequest) => Promise<void>;
  }
  interface FastifyRequest {
    auth?: { sessionId: string; userId: string };
  }
}

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/** Custom header a cross-site form/image cannot send without a CORS preflight. */
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_VALUE = 'pfm';

export async function buildApp({
  env,
  db,
  mailer,
  now,
}: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'res.headers["set-cookie"]',
          '*.password',
          '*.passwordHash',
          '*.token',
        ],
        censor: '[redacted]',
      },
    },
    trustProxy: env.NODE_ENV === 'production',
    bodyLimit: 1_048_576,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.decorate('env', env);
  app.decorate('db', db);
  const sessions = createSessionService(db, { ttlDays: env.SESSION_TTL_DAYS });
  app.decorate('sessions', sessions);
  const clock = now ?? (() => new Date());
  app.decorate('now', clock);
  app.decorate('recurring', createRecurringService(db, clock, createTransactionsService(db)));
  const resolvedMailer =
    mailer ??
    new ConsoleMailer((obj, msg) => app.log.info(obj, msg), env.NODE_ENV !== 'production');
  app.decorate('mailer', resolvedMailer);
  app.decorate(
    'auth',
    createAuthService({
      db,
      sessions,
      tokens: createAuthTokenService(db),
      mailer: resolvedMailer,
      appUrl: env.WEB_ORIGINS[0] ?? 'http://localhost:5173',
    }),
  );

  // ---- security plugins
  await app.register(helmet, { contentSecurityPolicy: false }); // API serves JSON; CSP belongs on the web host
  await app.register(cors, {
    origin: env.WEB_ORIGINS,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', CSRF_HEADER],
  });
  await app.register(cookie, { secret: env.SESSION_SECRET });
  await app.register(rateLimit, { global: true, max: env.RATE_LIMIT_MAX, timeWindow: '1 minute' });

  // ---- CSRF: SameSite cookie + required custom header + Origin allowlist on unsafe methods
  app.addHook('onRequest', async (request) => {
    if (!UNSAFE_METHODS.has(request.method)) return;
    if (request.headers[CSRF_HEADER] !== CSRF_VALUE) {
      throw new AppError(
        403,
        'csrf_failed',
        'This request was blocked for your protection. Reload the page and try again.',
      );
    }
    const origin = request.headers.origin;
    if (origin && !env.WEB_ORIGINS.includes(origin)) {
      throw new AppError(403, 'csrf_failed', 'This request came from an unrecognised site.');
    }
  });

  // ---- authentication decorator
  app.decorate('requireUser', async (request: FastifyRequest) => {
    const raw = request.cookies[SESSION_COOKIE];
    const unsigned = raw ? request.unsignCookie(raw) : null;
    if (!unsigned?.valid || !unsigned.value) throw AppError.unauthorized();
    const result = await sessions.validate(unsigned.value);
    if (!result) throw AppError.unauthorized('Your session has expired. Sign in again.');
    request.auth = { sessionId: result.sessionId, userId: result.user.id };
  });

  // ---- error envelope: { error: { code, message, details? } }
  app.setErrorHandler((error, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      const details: Record<string, string[]> = {};
      for (const issue of error.validation) {
        const path = issue.instancePath.replace(/^\//, '').replace(/\//g, '.') || '_';
        (details[path] ??= []).push(issue.message ?? 'Invalid value');
      }
      return reply.status(400).send({
        error: { code: 'validation_failed', message: 'Some fields need attention.', details },
      });
    }
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
      });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 429) {
      return reply.status(429).send({
        error: { code: 'rate_limited', message: 'Too many attempts. Wait a minute and try again.' },
      });
    }
    if (status && status >= 400 && status < 500) {
      return reply.status(status).send({
        error: { code: 'bad_request', message: 'The request could not be understood.' },
      });
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply.status(500).send({
      error: {
        code: 'internal_error',
        message: 'We hit a problem on our side. Try again in a moment.',
      },
    });
  });

  app.setNotFoundHandler((_req, reply) =>
    reply
      .status(404)
      .send({ error: { code: 'not_found', message: 'That endpoint does not exist.' } }),
  );

  // ---- OpenAPI
  await app.register(swagger, {
    openapi: {
      info: { title: 'Personal Finance Tracker API', version: '0.1.0' },
      components: {
        securitySchemes: { session: { type: 'apiKey', in: 'cookie', name: SESSION_COOKIE } },
      },
    },
    transform: jsonSchemaTransform,
  });
  if (env.NODE_ENV !== 'production') await app.register(swaggerUi, { routePrefix: '/api/docs' });

  // ---- routes
  await app.register(healthRoutes, { prefix: '/api' });
  await app.register(authRoutes, { prefix: '/api' });
  await app.register(accountsRoutes, { prefix: '/api' });
  await app.register(categoriesRoutes, { prefix: '/api' });
  await app.register(transactionsRoutes, { prefix: '/api' });
  await app.register(analyticsRoutes, { prefix: '/api' });
  await app.register(budgetsRoutes, { prefix: '/api' });
  await app.register(goalsRoutes, { prefix: '/api' });
  await app.register(recurringRoutes, { prefix: '/api' });
  await app.register(notificationsRoutes, { prefix: '/api' });
  await app.register(calendarRoutes, { prefix: '/api' });
  await app.register(searchRoutes, { prefix: '/api' });
  await app.register(importExportRoutes, { prefix: '/api' });

  return app;
}
