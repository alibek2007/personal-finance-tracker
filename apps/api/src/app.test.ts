import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../test/helpers';

describe('app security & plumbing', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('reports liveness and readiness (real database)', async () => {
    const live = await ctx.app.inject({ method: 'GET', url: '/api/health' });
    expect(live.statusCode).toBe(200);
    expect(live.json()).toEqual({ status: 'ok' });

    const ready = await ctx.app.inject({ method: 'GET', url: '/api/ready' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({ status: 'ready' });
  });

  it('sets security headers', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('answers unknown routes with the error envelope', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
  });

  it('allows CORS only for configured origins', async () => {
    const ok = await ctx.app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: 'http://localhost:5173' },
    });
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(ok.headers['access-control-allow-credentials']).toBe('true');

    const bad = await ctx.app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: 'https://evil.example' },
    });
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });

  describe('CSRF protection on unsafe methods', () => {
    it('rejects a POST without the custom header', async () => {
      const res = await ctx.app.inject({ method: 'POST', url: '/api/anything', payload: {} });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('csrf_failed');
    });

    it('rejects a POST from an unknown origin even with the header', async () => {
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/api/anything',
        payload: {},
        headers: { 'x-requested-with': 'pfm', origin: 'https://evil.example' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('lets a legitimate request through to routing', async () => {
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/api/anything',
        payload: {},
        headers: { 'x-requested-with': 'pfm', origin: 'http://localhost:5173' },
      });
      expect(res.statusCode).toBe(404); // passed CSRF, no such route
    });
  });

  it('requireUser rejects requests without a session', async () => {
    const fresh = await createTestApp();
    fresh.app.get('/api/_private', { preHandler: fresh.app.requireUser }, async () => ({
      ok: true,
    }));
    const res = await fresh.app.inject({ method: 'GET', url: '/api/_private' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('unauthorized');
    await fresh.close();
  });
});
