import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  changePasswordSchema,
  loginSchema,
  passwordResetRequestSchema,
  passwordResetSchema,
  registerSchema,
  updateProfileSchema,
  userSchema,
  verifyEmailSchema,
} from '@pfm/validation';
import { AppError } from '../../utils/errors';
import { audit } from '../audit/audit.service';
import { toUserDto } from './auth.service';
import { SESSION_COOKIE } from './session.service';

const okSchema = z.object({ ok: z.literal(true) });
const userResponse = z.object({ user: userSchema });

function meta(request: FastifyRequest) {
  return { ip: request.ip, userAgent: request.headers['user-agent'] };
}

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  const { env, auth } = app;

  function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date) {
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: env.COOKIE_SECURE,
      sameSite: 'lax',
      path: '/',
      signed: true,
      expires: expiresAt,
    });
  }

  /** Strict per-route limit. Keyed on IP (+ email when present) so one attacker can't lock out a victim globally. */
  const strict = (max = env.AUTH_RATE_LIMIT_MAX) => ({
    rateLimit: {
      max,
      timeWindow: '1 minute',
      hook: 'preHandler' as const,
      keyGenerator: (request: FastifyRequest) => {
        const email = (request.body as { email?: unknown } | undefined)?.email;
        return `${request.ip}:${request.routeOptions.url}:${typeof email === 'string' ? email.toLowerCase() : ''}`;
      },
    },
  });

  app.post(
    '/auth/register',
    {
      config: strict(),
      schema: {
        tags: ['auth'],
        body: registerSchema,
        response: { 201: userResponse },
      },
    },
    async (request, reply) => {
      const { user, session } = await auth.register(request.body, meta(request));
      setSessionCookie(reply, session.token, session.expiresAt);
      return reply.status(201).send({ user: toUserDto(user) });
    },
  );

  app.post(
    '/auth/login',
    {
      config: strict(),
      schema: { tags: ['auth'], body: loginSchema, response: { 200: userResponse } },
    },
    async (request, reply) => {
      const { user, session } = await auth.login(
        request.body.email,
        request.body.password,
        meta(request),
      );
      setSessionCookie(reply, session.token, session.expiresAt);
      return { user: toUserDto(user) };
    },
  );

  app.post(
    '/auth/logout',
    {
      preHandler: app.requireUser,
      schema: { tags: ['auth'], response: { 200: okSchema } },
    },
    async (request, reply) => {
      const raw = request.cookies[SESSION_COOKIE];
      const token = raw ? request.unsignCookie(raw).value : null;
      if (token) await auth.logout(request.auth!.userId, token, meta(request));
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return { ok: true as const };
    },
  );

  app.post(
    '/auth/change-password',
    {
      config: strict(5),
      preHandler: app.requireUser,
      schema: { tags: ['auth'], body: changePasswordSchema, response: { 200: okSchema } },
    },
    async (request) => {
      const { userId, sessionId } = request.auth!;
      await auth.changePassword(userId, sessionId, request.body, meta(request));
      return { ok: true as const };
    },
  );

  app.post(
    '/auth/verify-email/request',
    {
      config: strict(3),
      preHandler: app.requireUser,
      schema: { tags: ['auth'], response: { 200: okSchema } },
    },
    async (request) => {
      await auth.requestEmailVerification(request.auth!.userId);
      return { ok: true as const };
    },
  );

  app.post(
    '/auth/verify-email',
    {
      config: strict(),
      schema: { tags: ['auth'], body: verifyEmailSchema, response: { 200: okSchema } },
    },
    async (request) => {
      await auth.verifyEmail(request.body.token, meta(request));
      return { ok: true as const };
    },
  );

  app.post(
    '/auth/password-reset/request',
    {
      config: strict(5),
      schema: { tags: ['auth'], body: passwordResetRequestSchema, response: { 200: okSchema } },
    },
    async (request) => {
      await auth.requestPasswordReset(request.body.email);
      return { ok: true as const };
    },
  );

  app.post(
    '/auth/password-reset',
    {
      config: strict(),
      schema: { tags: ['auth'], body: passwordResetSchema, response: { 200: okSchema } },
    },
    async (request) => {
      await auth.resetPassword(request.body.token, request.body.password, meta(request));
      return { ok: true as const };
    },
  );

  // ---- current user
  app.get(
    '/me',
    {
      preHandler: app.requireUser,
      schema: { tags: ['me'], response: { 200: userResponse } },
    },
    async (request) => {
      const user = await app.db.user.findUnique({ where: { id: request.auth!.userId } });
      if (!user) throw AppError.unauthorized();
      return { user: toUserDto(user) };
    },
  );

  app.patch(
    '/me',
    {
      preHandler: app.requireUser,
      schema: { tags: ['me'], body: updateProfileSchema, response: { 200: userResponse } },
    },
    async (request) => {
      const userId = request.auth!.userId;
      const user = await app.db.user.update({ where: { id: userId }, data: request.body });
      await audit(app.db, {
        userId,
        action: 'profile.updated',
        metadata: { fields: Object.keys(request.body) },
        ...meta(request),
      });
      return { user: toUserDto(user) };
    },
  );
};
