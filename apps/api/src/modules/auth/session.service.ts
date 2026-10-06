import type { Db } from '../../lib/db';
import { generateToken, hashToken } from '../../lib/tokens';

export const SESSION_COOKIE = 'pfm_session';

export interface SessionMeta {
  userAgent?: string | undefined;
  ip?: string | undefined;
}

export interface SessionServiceOptions {
  ttlDays: number;
  /** Injected clock keeps expiry logic deterministic in tests. */
  now?: () => Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Avoid a write on every request: only slide the expiry when it is this stale. */
const TOUCH_INTERVAL_MS = 10 * 60 * 1000;

export function createSessionService(db: Db, options: SessionServiceOptions) {
  const now = options.now ?? (() => new Date());
  const ttlMs = options.ttlDays * DAY_MS;

  return {
    /** Returns the raw token to set in the cookie. Only its hash is stored. */
    async create(
      userId: string,
      meta: SessionMeta = {},
    ): Promise<{ token: string; expiresAt: Date }> {
      const token = generateToken();
      const expiresAt = new Date(now().getTime() + ttlMs);
      await db.session.create({
        data: {
          userId,
          tokenHash: hashToken(token),
          expiresAt,
          userAgent: meta.userAgent?.slice(0, 255) ?? null,
          ip: meta.ip ?? null,
        },
      });
      return { token, expiresAt };
    },

    /** Resolves a cookie token to its user, sliding the expiry. Returns null if invalid/expired. */
    async validate(token: string) {
      const session = await db.session.findUnique({
        where: { tokenHash: hashToken(token) },
        include: { user: true },
      });
      if (!session) return null;
      const current = now();
      if (session.expiresAt <= current) {
        await db.session.delete({ where: { id: session.id } }).catch(() => undefined);
        return null;
      }
      if (current.getTime() - session.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
        await db.session.update({
          where: { id: session.id },
          data: { lastUsedAt: current, expiresAt: new Date(current.getTime() + ttlMs) },
        });
      }
      return { sessionId: session.id, user: session.user };
    },

    async revoke(token: string): Promise<void> {
      await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
    },

    /** Used on password change / "sign out everywhere". */
    async revokeAllForUser(userId: string, exceptSessionId?: string): Promise<void> {
      await db.session.deleteMany({
        where: { userId, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
      });
    },

    async purgeExpired(): Promise<number> {
      const { count } = await db.session.deleteMany({ where: { expiresAt: { lte: now() } } });
      return count;
    },
  };
}

export type SessionService = ReturnType<typeof createSessionService>;
