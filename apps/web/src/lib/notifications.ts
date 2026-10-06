import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  notificationListSchema,
  notificationSchema,
  unreadCountSchema,
  type NotificationListDto,
} from '@pfm/validation';
import { api } from './api';

/** How often the bell checks for news while the app is open. */
const POLL_MS = 60_000;

export function useNotifications(unreadOnly = false) {
  return useQuery({
    queryKey: ['notifications', 'list', { unreadOnly }],
    queryFn: () =>
      api(`/notifications?limit=100${unreadOnly ? '&unread=true' : ''}`, notificationListSchema),
  });
}

export function useUnreadCount() {
  return useQuery({
    queryKey: ['notifications', 'count'],
    refetchInterval: POLL_MS,
    queryFn: () => api('/notifications/unread-count', unreadCountSchema),
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['notifications'] });
}

export function useSetRead() {
  const invalidate = useInvalidate();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isRead }: { id: string; isRead: boolean }) =>
      api(`/notifications/${id}`, notificationSchema, { method: 'PATCH', body: { isRead } }),
    // Flip it on screen immediately; the refetch confirms.
    onMutate: async ({ id, isRead }) => {
      await qc.cancelQueries({ queryKey: ['notifications'] });
      const previous = qc.getQueriesData<NotificationListDto>({
        queryKey: ['notifications', 'list'],
      });
      for (const [key, data] of previous) {
        if (!data) continue;
        const items = data.items.map((n) => (n.id === id ? { ...n, isRead } : n));
        qc.setQueryData<NotificationListDto>(key, {
          items,
          unreadCount: items.filter((n) => !n.isRead).length,
        });
      }
      return { previous };
    },
    onError: (_error, _vars, context) => {
      for (const [key, data] of context?.previous ?? []) qc.setQueryData(key, data);
    },
    onSettled: invalidate,
  });
}

export function useMarkAllRead() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: () =>
      api('/notifications/read-all', unreadCountSchema, { method: 'POST', body: {} }),
    onSuccess: invalidate,
  });
}
