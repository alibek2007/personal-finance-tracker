import { useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  userSchema,
  type ChangePasswordInput,
  type LoginInput,
  type RegisterInput,
  type UpdateProfileInput,
  type UserDto,
} from '@pfm/validation';
import { api, ApiError } from './api';
import { ME_KEY } from './query';

const userResponse = z.object({ user: userSchema });
const ok = z.object({ ok: z.literal(true) });

/** The signed-in user, `null` when signed out, error only when the server is unreachable. */
export function useSession() {
  return useQuery<UserDto | null>({
    queryKey: ME_KEY,
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      try {
        return (await api('/me', userResponse)).user;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
  });
}

/**
 * For screens behind <RequireAuth/>. When the session ends, children can render once more before the
 * guard unmounts them; keep showing the last known user for that frame rather than crashing.
 */
export function useCurrentUser(): UserDto {
  const { data } = useSession();
  const last = useRef<UserDto | null>(null);
  if (data) last.current = data;
  const user = data ?? last.current;
  if (!user) throw new Error('useCurrentUser used outside an authenticated route');
  return user;
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) =>
      api('/auth/login', userResponse, { method: 'POST', body: input }),
    onSuccess: ({ user }) => qc.setQueryData(ME_KEY, user),
  });
}

export function useRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RegisterInput) =>
      api('/auth/register', userResponse, { method: 'POST', body: input }),
    onSuccess: ({ user }) => qc.setQueryData(ME_KEY, user),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api('/auth/logout', ok, { method: 'POST' }),
    onSettled: () => {
      // Flip to signed-out first so the route guard redirects before anything re-renders without a user,
      // then drop every other cached query so no financial data lingers on this device.
      qc.setQueryData(ME_KEY, null);
      qc.removeQueries({ predicate: (query) => query.queryKey[0] !== ME_KEY[0] });
    },
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateProfileInput) =>
      api('/me', userResponse, { method: 'PATCH', body: input }),
    onSuccess: ({ user }) => qc.setQueryData(ME_KEY, user),
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (input: ChangePasswordInput) =>
      api('/auth/change-password', ok, { method: 'POST', body: input }),
  });
}

export function useResendVerification() {
  return useMutation({
    mutationFn: () => api('/auth/verify-email/request', ok, { method: 'POST' }),
  });
}

export function useVerifyEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) =>
      api('/auth/verify-email', ok, { method: 'POST', body: { token } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ME_KEY }),
  });
}

export function useRequestPasswordReset() {
  return useMutation({
    mutationFn: (email: string) =>
      api('/auth/password-reset/request', ok, { method: 'POST', body: { email } }),
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: (input: { token: string; password: string }) =>
      api('/auth/password-reset', ok, { method: 'POST', body: input }),
  });
}
