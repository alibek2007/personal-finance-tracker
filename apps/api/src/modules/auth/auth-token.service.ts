import type { AuthTokenPurpose } from '@prisma/client';
import type { Db } from '../../lib/db';
import { generateToken, hashToken } from '../../lib/tokens';

const TTL_MS: Record<AuthTokenPurpose, number> = {
  email_verification: 24 * 60 * 60 * 1000,
  password_reset: 60 * 60 * 1000,
};

/** Single-use, hashed, expiring tokens for email verification and password reset. */
export function createAuthTokenService(db: Db, now: () => Date = () => new Date()) {
  return {
    /** Issues a fresh token and invalidates any earlier unused one for the same purpose. */
    async issue(userId: string, purpose: AuthTokenPurpose): Promise<string> {
      const token = generateToken();
      await db.$transaction([
        db.authToken.deleteMany({ where: { userId, purpose, consumedAt: null } }),
        db.authToken.create({
          data: {
            userId,
            purpose,
            tokenHash: hashToken(token),
            expiresAt: new Date(now().getTime() + TTL_MS[purpose]),
          },
        }),
      ]);
      return token;
    },

    /** Atomically marks the token consumed. Returns the user id, or null if invalid/used/expired. */
    async consume(token: string, purpose: AuthTokenPurpose): Promise<string | null> {
      const tokenHash = hashToken(token);
      const current = now();
      const { count } = await db.authToken.updateMany({
        where: { tokenHash, purpose, consumedAt: null, expiresAt: { gt: current } },
        data: { consumedAt: current },
      });
      if (count !== 1) return null;
      const row = await db.authToken.findUnique({ where: { tokenHash } });
      return row?.userId ?? null;
    },
  };
}

export type AuthTokenService = ReturnType<typeof createAuthTokenService>;
