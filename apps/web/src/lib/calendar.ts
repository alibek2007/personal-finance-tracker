import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { calendarSchema } from '@pfm/validation';
import { api } from './api';

/** Keyed under `transactions` so any ledger change refreshes the calendar too. */
export function useCalendar(from: string, to: string) {
  return useQuery({
    queryKey: ['transactions', 'calendar', from, to],
    placeholderData: keepPreviousData,
    queryFn: () => api(`/calendar?from=${from}&to=${to}`, calendarSchema),
  });
}
