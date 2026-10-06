import { describe, expect, it } from 'vitest';
import { loadEnv } from '../config/env';
import { hashPassword, verifyPassword } from './password';
import { generateToken, hashToken, safeEqual } from './tokens';

describe('passwords', () => {
  it('hashes with argon2id and verifies', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain('correct horse');
    expect(await verifyPassword(hash, 'correct horse battery staple')).toBe(true);
    expect(await verifyPassword(hash, 'wrong')).toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('returns false (never throws) for a malformed hash', async () => {
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
  });
});

describe('tokens', () => {
  it('are long, unique and URL safe', () => {
    const a = generateToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateToken()).not.toBe(a);
  });

  it('hash deterministically and compare safely', () => {
    expect(hashToken('x')).toBe(hashToken('x'));
    expect(hashToken('x')).toMatch(/^[0-9a-f]{64}$/);
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('env', () => {
  const base = {
    DATABASE_URL: 'postgresql://x',
    SESSION_SECRET: 'x'.repeat(40),
  };

  it('applies defaults and parses origins', () => {
    const env = loadEnv({ ...base, WEB_ORIGINS: 'http://a.test, http://b.test' });
    expect(env.API_PORT).toBe(4000);
    expect(env.WEB_ORIGINS).toEqual(['http://a.test', 'http://b.test']);
    expect(env.COOKIE_SECURE).toBe(false);
  });

  it('fails loudly with a helpful message', () => {
    expect(() => loadEnv({ SESSION_SECRET: 'short' })).toThrow(/DATABASE_URL/);
    expect(() => loadEnv({ DATABASE_URL: 'x', SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/);
  });

  it('enforces secure settings in production', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production' })).toThrow(/COOKIE_SECURE/);
    expect(() =>
      loadEnv({
        ...base,
        NODE_ENV: 'production',
        COOKIE_SECURE: 'true',
        SESSION_SECRET: 'change-me'.padEnd(40, 'x'),
      }),
    ).toThrow(/SESSION_SECRET/);
    expect(loadEnv({ ...base, NODE_ENV: 'production', COOKIE_SECURE: 'true' }).NODE_ENV).toBe(
      'production',
    );
  });
});
