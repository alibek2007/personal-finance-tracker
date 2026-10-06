import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 256-bit opaque token, URL/cookie safe. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Only this digest is persisted; a database leak does not reveal usable tokens. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
