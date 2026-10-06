import { QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';

export const ME_KEY = ['me'] as const;

/**
 * One factory for the app and the tests. A 401 from any request means the session ended
 * (expired, signed out elsewhere), so we drop the cached user and the route guard sends them to sign in.
 */
export function createQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (error instanceof ApiError && error.status === 401 && query.queryKey[0] !== ME_KEY[0]) {
          client.setQueryData(ME_KEY, null);
        }
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
      },
    },
  });
  return client;
}
