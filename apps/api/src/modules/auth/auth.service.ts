import type { User } from '@prisma/client';
import type { ChangePasswordInput, RegisterInput, UserDto } from '@pfm/validation';
import { isCurrencyCode } from '@pfm/finance';
import type { Db } from '../../lib/db';
import type { Mailer } from '../../lib/mailer';
import { burnPasswordCheck, hashPassword, verifyPassword } from '../../lib/password';
import { AppError } from '../../utils/errors';
import { audit } from '../audit/audit.service';
import { seedDefaultCategories } from '../categories/categories.service';
import type { AuthTokenService } from './auth-token.service';
import type { SessionMeta, SessionService } from './session.service';

export interface AuthDeps {
  db: Db;
  sessions: SessionService;
  tokens: AuthTokenService;
  mailer: Mailer;
  /** Public web origin used to build links in emails. */
  appUrl: string;
}

export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatar: user.avatar,
    currency: isCurrencyCode(user.currency) ? user.currency : 'USD',
    timezone: user.timezone,
    locale: user.locale,
    emailVerified: user.emailVerifiedAt !== null,
  };
}

export function createAuthService(deps: AuthDeps) {
  const { db, sessions, tokens, mailer, appUrl } = deps;

  async function sendVerification(user: Pick<User, 'id' | 'email' | 'name'>) {
    const token = await tokens.issue(user.id, 'email_verification');
    await mailer.send({
      to: user.email,
      subject: 'Confirm your email for Ledger',
      text: `Hi ${user.name},\n\nConfirm your email address: ${appUrl}/verify-email?token=${token}\n\nThe link works once and expires in 24 hours. If you did not create an account, ignore this message.`,
    });
  }

  return {
    async register(input: RegisterInput, meta: SessionMeta) {
      const existing = await db.user.findUnique({ where: { email: input.email } });
      if (existing) {
        throw AppError.conflict(
          'An account with this email already exists. Try signing in instead.',
          'email_taken',
        );
      }
      const user = await db.user.create({
        data: {
          email: input.email,
          name: input.name,
          currency: input.currency,
          timezone: input.timezone,
          passwordHash: await hashPassword(input.password),
        },
      });
      await seedDefaultCategories(db, user.id);
      const session = await sessions.create(user.id, meta);
      await audit(db, { userId: user.id, action: 'auth.register', ...meta });
      void sendVerification(user).catch(() => undefined); // never block sign-up on email delivery
      return { user, session };
    },

    async login(email: string, password: string, meta: SessionMeta) {
      const user = await db.user.findUnique({ where: { email } });
      const valid = user ? await verifyPassword(user.passwordHash, password) : false;
      if (!user || !valid) {
        if (!user) await burnPasswordCheck(password); // equalise timing: no account enumeration
        await audit(db, {
          userId: user?.id ?? null,
          action: 'auth.login_failed',
          ...meta,
        });
        // One message for both cases on purpose.
        throw new AppError(401, 'invalid_credentials', 'That email and password do not match.');
      }
      const session = await sessions.create(user.id, meta);
      await audit(db, { userId: user.id, action: 'auth.login', ...meta });
      return { user, session };
    },

    async logout(userId: string, token: string, meta: SessionMeta) {
      await sessions.revoke(token);
      await audit(db, { userId, action: 'auth.logout', ...meta });
    },

    async changePassword(
      userId: string,
      currentSessionId: string,
      input: ChangePasswordInput,
      meta: SessionMeta,
    ) {
      const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
      if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
        throw AppError.badRequest('Your current password is not correct.', 'wrong_password', {
          currentPassword: ['Your current password is not correct.'],
        });
      }
      await db.user.update({
        where: { id: userId },
        data: { passwordHash: await hashPassword(input.newPassword) },
      });
      await sessions.revokeAllForUser(userId, currentSessionId); // sign out every other device
      await audit(db, { userId, action: 'auth.password_changed', ...meta });
    },

    async requestEmailVerification(userId: string) {
      const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
      if (user.emailVerifiedAt) return;
      await sendVerification(user);
    },

    async verifyEmail(token: string, meta: SessionMeta) {
      const userId = await tokens.consume(token, 'email_verification');
      if (!userId) {
        throw AppError.badRequest(
          'This confirmation link has expired or was already used. Request a new one from your profile.',
          'invalid_token',
        );
      }
      await db.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
      await audit(db, { userId, action: 'auth.email_verified', ...meta });
    },

    /** Always resolves the same way so callers cannot learn which emails have accounts. */
    async requestPasswordReset(email: string) {
      const user = await db.user.findUnique({ where: { email } });
      if (!user) return;
      const token = await tokens.issue(user.id, 'password_reset');
      await mailer.send({
        to: user.email,
        subject: 'Reset your Ledger password',
        text: `Hi ${user.name},\n\nChoose a new password: ${appUrl}/reset-password?token=${token}\n\nThe link works once and expires in 1 hour. If you did not ask for this, you can ignore it; your password has not changed.`,
      });
    },

    async resetPassword(token: string, password: string, meta: SessionMeta) {
      const userId = await tokens.consume(token, 'password_reset');
      if (!userId) {
        throw AppError.badRequest(
          'This reset link has expired or was already used. Request a new one.',
          'invalid_token',
        );
      }
      await db.user.update({
        where: { id: userId },
        data: { passwordHash: await hashPassword(password) },
      });
      await sessions.revokeAllForUser(userId);
      await audit(db, { userId, action: 'auth.password_reset', ...meta });
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
