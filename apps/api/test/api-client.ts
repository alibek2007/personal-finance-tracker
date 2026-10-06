import type { LightMyRequestResponse } from 'fastify';
import type { createTestApp } from './helpers';

type Ctx = Awaited<ReturnType<typeof createTestApp>>;

const HEADERS = { 'x-requested-with': 'pfm', origin: 'http://localhost:5173' };
const PASSWORD = 'correct horse battery staple';

export interface Session {
  cookie: string;
  userId: string;
}

/** Thin authenticated HTTP client over `app.inject`, used by integration tests. */
export function createApiClient(ctx: Ctx) {
  async function call(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    session: Session | null,
    payload?: unknown,
  ): Promise<LightMyRequestResponse> {
    return ctx.app.inject({
      method,
      url,
      headers: HEADERS,
      ...(payload !== undefined ? { payload: payload as object } : {}),
      ...(session ? { cookies: { pfm_session: session.cookie } } : {}),
    });
  }

  return {
    get: (url: string, s: Session | null) => call('GET', url, s),
    post: (url: string, s: Session | null, body?: unknown) => call('POST', url, s, body ?? {}),
    patch: (url: string, s: Session | null, body: unknown) => call('PATCH', url, s, body),
    delete: (url: string, s: Session | null) => call('DELETE', url, s),

    async signUp(email: string, name = 'Test User'): Promise<Session> {
      const res = await call('POST', '/api/auth/register', null, {
        name,
        email,
        password: PASSWORD,
      });
      if (res.statusCode !== 201) throw new Error(`register failed: ${res.body}`);
      const cookie = res.cookies.find((c) => c.name === 'pfm_session')?.value;
      if (!cookie) throw new Error('no session cookie');
      return { cookie, userId: res.json().user.id };
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
