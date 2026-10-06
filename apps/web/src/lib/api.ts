import { z } from 'zod';

/** Thrown for any non-2xx response; carries the server's human-readable message. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const errorBody = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.array(z.string())).optional(),
  }),
});

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Typed fetch wrapper: cookies included, CSRF header on unsafe methods, response validated by schema. */
export async function api<T>(
  path: string,
  schema: z.ZodType<T>,
  init: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const method = init.method ?? 'GET';
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: 'include',
      signal: init.signal,
      headers: {
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(UNSAFE.has(method) ? { 'x-requested-with': 'pfm' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(
      0,
      'network',
      'Could not reach the server. Check your connection and try again.',
    );
  }
  if (!response.ok) {
    const parsed = errorBody.safeParse(await response.json().catch(() => null));
    if (parsed.success) {
      const { code, message, details } = parsed.data.error;
      throw new ApiError(response.status, code, message, details);
    }
    throw new ApiError(
      response.status,
      'unknown',
      'The server sent an unexpected response. Try again in a moment.',
    );
  }
  return schema.parse(await response.json());
}
