import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, resetDb } from '../../../test/helpers';

type Ctx = Awaited<ReturnType<typeof createTestApp>>;

const HEADERS = { 'x-requested-with': 'pfm', origin: 'http://localhost:5173' };
const PASSWORD = 'correct horse battery staple';

function client(ctx: Ctx) {
  const post = (url: string, payload?: unknown, cookie?: string) =>
    ctx.app.inject({
      method: 'POST',
      url,
      payload: payload as object,
      headers: HEADERS,
      ...(cookie ? { cookies: { pfm_session: cookie } } : {}),
    });
  const get = (url: string, cookie?: string) =>
    ctx.app.inject({
      method: 'GET',
      url,
      ...(cookie ? { cookies: { pfm_session: cookie } } : {}),
    });
  const patch = (url: string, payload: unknown, cookie?: string) =>
    ctx.app.inject({
      method: 'PATCH',
      url,
      payload: payload as object,
      headers: HEADERS,
      ...(cookie ? { cookies: { pfm_session: cookie } } : {}),
    });
  const register = async (email = 'alex@example.com', name = 'Alex') => {
    const res = await post('/api/auth/register', { name, email, password: PASSWORD });
    return { res, cookie: res.cookies.find((c) => c.name === 'pfm_session')?.value };
  };
  const login = async (email = 'alex@example.com', password = PASSWORD) => {
    const res = await post('/api/auth/login', { email, password });
    return { res, cookie: res.cookies.find((c) => c.name === 'pfm_session')?.value };
  };
  return { post, get, patch, register, login };
}

function tokenFromMail(body: string): string {
  const match = /token=([A-Za-z0-9_-]+)/.exec(body);
  if (!match?.[1]) throw new Error('no token in email');
  return match[1];
}

describe('auth API', () => {
  let ctx: Ctx;
  let api: ReturnType<typeof client>;

  beforeAll(async () => {
    ctx = await createTestApp();
    api = client(ctx);
  });
  afterAll(async () => {
    await ctx.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.db);
    ctx.mailer.sent.length = 0;
  });

  describe('register', () => {
    it('creates the account, signs in with a hardened cookie and never leaks the hash', async () => {
      const { res, cookie } = await api.register();
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.user).toMatchObject({
        email: 'alex@example.com',
        name: 'Alex',
        currency: 'USD',
        emailVerified: false,
      });
      expect(JSON.stringify(body)).not.toMatch(/passwordHash|argon2/);

      const setCookie = res.headers['set-cookie'];
      const raw = Array.isArray(setCookie) ? setCookie[0]! : String(setCookie);
      expect(raw).toMatch(/HttpOnly/i);
      expect(raw).toMatch(/SameSite=Lax/i);
      expect(raw).toMatch(/Path=\//);
      expect(cookie).toBeTruthy();

      const stored = await ctx.db.user.findUniqueOrThrow({ where: { email: 'alex@example.com' } });
      expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
    });

    it('sends a verification email with a one-time link', async () => {
      await api.register();
      await expect.poll(() => ctx.mailer.sent.length).toBe(1);
      expect(ctx.mailer.sent[0]?.to).toBe('alex@example.com');
      expect(ctx.mailer.sent[0]?.text).toContain('/verify-email?token=');
    });

    it('normalises email case and rejects duplicates', async () => {
      await api.register('Alex@Example.com');
      const again = await api.register('alex@example.COM');
      expect(again.res.statusCode).toBe(409);
      expect(again.res.json().error.code).toBe('email_taken');
    });

    it('explains validation problems field by field', async () => {
      const res = await api.post('/api/auth/register', {
        name: '',
        email: 'nope',
        password: 'short',
      });
      expect(res.statusCode).toBe(400);
      const { code, details } = res.json().error;
      expect(code).toBe('validation_failed');
      expect(Object.keys(details)).toEqual(expect.arrayContaining(['name', 'email', 'password']));
    });
  });

  describe('login', () => {
    it('signs in and returns the user', async () => {
      await api.register();
      const { res, cookie } = await api.login('ALEX@example.com');
      expect(res.statusCode).toBe(200);
      expect(res.json().user.email).toBe('alex@example.com');
      expect(cookie).toBeTruthy();
    });

    it('gives the same answer for a wrong password and an unknown email', async () => {
      await api.register();
      const wrong = await api.login('alex@example.com', 'definitely wrong pass');
      const unknown = await api.login('ghost@example.com', 'definitely wrong pass');
      expect(wrong.res.statusCode).toBe(401);
      expect(unknown.res.statusCode).toBe(401);
      expect(wrong.res.json()).toEqual(unknown.res.json());
      expect(wrong.cookie).toBeUndefined();
    });

    it('records audit events without secrets', async () => {
      await api.register();
      await api.login();
      await api.login('alex@example.com', 'definitely wrong pass');
      const actions = (await ctx.db.auditLog.findMany({ orderBy: { createdAt: 'asc' } })).map(
        (a) => a.action,
      );
      expect(actions).toEqual(['auth.register', 'auth.login', 'auth.login_failed']);
      const raw = JSON.stringify(await ctx.db.auditLog.findMany());
      expect(raw).not.toContain(PASSWORD);
    });

    it('requires the CSRF header', async () => {
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'a@b.co', password: 'x' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('csrf_failed');
    });
  });

  describe('session lifecycle', () => {
    it('GET /me needs a valid session', async () => {
      expect((await api.get('/api/me')).statusCode).toBe(401);
      const { cookie } = await api.register();
      const me = await api.get('/api/me', cookie);
      expect(me.statusCode).toBe(200);
      expect(me.json().user.name).toBe('Alex');
    });

    it('rejects a forged or tampered cookie', async () => {
      const { cookie } = await api.register();
      expect((await api.get('/api/me', 'forged-value')).statusCode).toBe(401);
      expect((await api.get('/api/me', `${cookie}x`)).statusCode).toBe(401);
    });

    it('logout destroys the session server-side', async () => {
      const { cookie } = await api.register();
      const out = await api.post('/api/auth/logout', undefined, cookie);
      expect(out.statusCode).toBe(200);
      expect(await ctx.db.session.count()).toBe(0);
      expect((await api.get('/api/me', cookie)).statusCode).toBe(401); // replay fails
    });
  });

  describe('profile', () => {
    it('updates name, currency and timezone', async () => {
      const { cookie } = await api.register();
      const res = await api.patch(
        '/api/me',
        { name: 'Alex M', currency: 'KZT', timezone: 'Asia/Almaty' },
        cookie,
      );
      expect(res.statusCode).toBe(200);
      expect(res.json().user).toMatchObject({
        name: 'Alex M',
        currency: 'KZT',
        timezone: 'Asia/Almaty',
      });
    });

    it('rejects unsupported currencies, bad timezones and empty updates', async () => {
      const { cookie } = await api.register();
      expect((await api.patch('/api/me', { currency: 'XXX' }, cookie)).statusCode).toBe(400);
      expect((await api.patch('/api/me', { timezone: 'Mars/Base' }, cookie)).statusCode).toBe(400);
      expect((await api.patch('/api/me', {}, cookie)).statusCode).toBe(400);
    });

    it('cannot be used to change email or password hash', async () => {
      const { cookie } = await api.register();
      await api.patch(
        '/api/me',
        { name: 'Alex', email: 'evil@example.com', passwordHash: 'x' },
        cookie,
      );
      const user = await ctx.db.user.findFirstOrThrow();
      expect(user.email).toBe('alex@example.com');
      expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    });
  });

  describe('change password', () => {
    it('requires the current password', async () => {
      const { cookie } = await api.register();
      const res = await api.post(
        '/api/auth/change-password',
        { currentPassword: 'not it at all', newPassword: 'a brand new passphrase' },
        cookie,
      );
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('wrong_password');
    });

    it('switches the password and signs out other devices but not this one', async () => {
      const { cookie: here } = await api.register();
      const { cookie: other } = await api.login();
      const res = await api.post(
        '/api/auth/change-password',
        { currentPassword: PASSWORD, newPassword: 'a brand new passphrase' },
        here,
      );
      expect(res.statusCode).toBe(200);
      expect((await api.get('/api/me', here)).statusCode).toBe(200);
      expect((await api.get('/api/me', other)).statusCode).toBe(401);
      expect((await api.login('alex@example.com', PASSWORD)).res.statusCode).toBe(401);
      expect((await api.login('alex@example.com', 'a brand new passphrase')).res.statusCode).toBe(
        200,
      );
    });
  });

  describe('email verification', () => {
    it('confirms the address once', async () => {
      const { cookie } = await api.register();
      await expect.poll(() => ctx.mailer.sent.length).toBe(1);
      const token = tokenFromMail(ctx.mailer.sent[0]!.text);

      expect((await api.post('/api/auth/verify-email', { token })).statusCode).toBe(200);
      expect((await api.get('/api/me', cookie)).json().user.emailVerified).toBe(true);

      const reuse = await api.post('/api/auth/verify-email', { token });
      expect(reuse.statusCode).toBe(400);
      expect(reuse.json().error.code).toBe('invalid_token');
    });

    it('a re-requested link invalidates the previous one', async () => {
      const { cookie } = await api.register();
      await expect.poll(() => ctx.mailer.sent.length).toBe(1);
      const first = tokenFromMail(ctx.mailer.sent[0]!.text);
      await api.post('/api/auth/verify-email/request', undefined, cookie);
      const second = tokenFromMail(ctx.mailer.sent[1]!.text);
      expect((await api.post('/api/auth/verify-email', { token: first })).statusCode).toBe(400);
      expect((await api.post('/api/auth/verify-email', { token: second })).statusCode).toBe(200);
    });

    it('rejects expired tokens', async () => {
      const { cookie } = await api.register();
      await expect.poll(() => ctx.mailer.sent.length).toBe(1);
      const token = tokenFromMail(ctx.mailer.sent[0]!.text);
      await ctx.db.authToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
      expect((await api.post('/api/auth/verify-email', { token })).statusCode).toBe(400);
      expect(cookie).toBeTruthy();
    });
  });

  describe('password reset', () => {
    it('answers identically for unknown emails and sends nothing', async () => {
      await api.register();
      await expect.poll(() => ctx.mailer.sent.length).toBe(1);
      ctx.mailer.sent.length = 0;
      const unknown = await api.post('/api/auth/password-reset/request', { email: 'ghost@x.co' });
      const known = await api.post('/api/auth/password-reset/request', {
        email: 'alex@example.com',
      });
      expect(unknown.statusCode).toBe(200);
      expect(unknown.json()).toEqual(known.json());
      expect(ctx.mailer.sent).toHaveLength(1);
    });

    it('resets once, signs out everywhere and allows the new password', async () => {
      const { cookie } = await api.register();
      await expect.poll(() => ctx.mailer.sent.length).toBe(1);
      ctx.mailer.sent.length = 0;
      await api.post('/api/auth/password-reset/request', { email: 'alex@example.com' });
      const token = tokenFromMail(ctx.mailer.sent[0]!.text);

      const done = await api.post('/api/auth/password-reset', {
        token,
        password: 'my second passphrase',
      });
      expect(done.statusCode).toBe(200);
      expect((await api.get('/api/me', cookie)).statusCode).toBe(401);
      expect((await api.login('alex@example.com', PASSWORD)).res.statusCode).toBe(401);
      expect((await api.login('alex@example.com', 'my second passphrase')).res.statusCode).toBe(
        200,
      );

      const reuse = await api.post('/api/auth/password-reset', {
        token,
        password: 'yet another passphrase',
      });
      expect(reuse.statusCode).toBe(400);
    });
  });
});

describe('auth rate limiting', () => {
  it('throttles repeated sign-in attempts with a helpful message', async () => {
    const ctx = await createTestApp({ AUTH_RATE_LIMIT_MAX: '3' });
    await resetDb(ctx.db);
    const api = client(ctx);
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) {
      codes.push((await api.login('alex@example.com', 'wrong password!!')).res.statusCode);
    }
    expect(codes).toEqual([401, 401, 401, 429, 429]);
    const limited = await api.login('alex@example.com', 'wrong password!!');
    expect(limited.res.json().error.code).toBe('rate_limited');
    // A different email from the same IP is tracked separately.
    expect((await api.login('someone@else.com', 'wrong password!!')).res.statusCode).toBe(401);
    await ctx.close();
  });
});
