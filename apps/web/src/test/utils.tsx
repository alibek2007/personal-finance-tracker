import { render } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { ThemeProvider, Toaster, TooltipProvider } from '@pfm/ui';
import type { UserDto } from '@pfm/validation';
import { AppRoutes } from '../App';
import { createQueryClient } from '../lib/query';

export const alex: UserDto = {
  id: 'u1',
  email: 'alex@example.com',
  name: 'Alex Morgan',
  avatar: null,
  currency: 'USD',
  timezone: 'UTC',
  locale: 'en-US',
  emailVerified: false,
};

export interface MockResponse {
  status?: number;
  json?: unknown;
}
export interface RequestInfo {
  query: URLSearchParams;
}
export type Handler = (body: unknown, info: RequestInfo) => MockResponse | Promise<MockResponse>;

export interface Call {
  method: string;
  path: string;
  query: string;
  body: unknown;
  headers: Record<string, string>;
}

/** Routes `fetch('/api/...')` to handlers keyed by "METHOD /path". Unhandled requests fail the test loudly. */
export function mockApi(handlers: Record<string, Handler>) {
  const calls: Call[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input).replace(/^\/api/, '');
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({
      method,
      path: url.split('?')[0] ?? url,
      query: url.split('?')[1] ?? '',
      body,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    const [path = '', search = ''] = url.split('?');
    // Exact match (with query string) wins, then the bare path.
    const handler = handlers[`${method} ${url}`] ?? handlers[`${method} ${path}`];
    if (!handler) throw new Error(`Unhandled request in test: ${method} ${url}`);
    const { status = 200, json } = await handler(body, { query: new URLSearchParams(search) });
    return new Response(json === undefined ? null : JSON.stringify(json), { status });
  });
  return calls;
}

export const emptyOverview = {
  currency: 'USD',
  today: '2026-10-15',
  totalBalance: 0,
  otherCurrencies: [],
  hasTransactions: false,
  month: {
    from: '2026-10-01',
    to: '2026-10-15',
    income: 0,
    spent: 0,
    saved: 0,
    savingsRateBp: null,
    daysElapsed: 15,
    daysInMonth: 31,
  },
  previous: {
    from: '2026-09-01',
    to: '2026-09-15',
    income: 0,
    spent: 0,
    saved: 0,
    savingsRateBp: null,
  },
  changes: { incomeBp: null, spentBp: null, savedBp: null },
  insights: [],
};

export const signedIn = (user: UserDto = alex): Record<string, Handler> => ({
  'GET /me': () => ({ json: { user } }),
  'GET /analytics/overview': () => ({ json: emptyOverview }),
  'GET /budgets': () => ({ json: { budgets: [], monthly: null } }),
  'GET /goals': () => ({ json: { goals: [], summary: null } }),
});
export const signedOut: Record<string, Handler> = {
  'GET /me': () => ({
    status: 401,
    json: { error: { code: 'unauthorized', message: 'Sign in to continue.' } },
  }),
};

export function renderApp(path = '/') {
  window.matchMedia ??= (() => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false, staleTime: 30_000 } });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <MemoryRouter initialEntries={[path]}>
            <AppRoutes />
          </MemoryRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}
