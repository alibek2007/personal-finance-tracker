import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button, Field, Input } from '@pfm/ui';
import { loginSchema, type LoginInput } from '@pfm/validation';
import { useLogin } from '../../lib/auth';
import { applyApiError } from '../../lib/forms';
import { AuthLayout, FormError } from './AuthLayout';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { from?: string; notice?: string } | null;
  const from = state?.from ?? '/';
  const login = useLogin();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await login.mutateAsync(values);
      navigate(from, { replace: true });
    } catch (error) {
      setFormError(applyApiError(error, setError));
    }
  });

  return (
    <AuthLayout
      title="Welcome back"
      intro="Sign in to see where your money stands."
      footer={
        <>
          New to Ledger?{' '}
          <Link
            to="/register"
            className="font-medium text-accent underline-offset-4 hover:underline"
          >
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        {state?.notice ? (
          <p
            role="status"
            className="rounded-md border border-gain/40 bg-gain-wash px-3 py-2 text-gain"
          >
            {state.notice}
          </p>
        ) : null}
        <FormError message={formError} />
        <Field label="Email" error={errors.email?.message}>
          <Input type="email" autoComplete="email" autoFocus {...register('email')} />
        </Field>
        <Field label="Password" error={errors.password?.message}>
          <Input type="password" autoComplete="current-password" {...register('password')} />
        </Field>
        <div className="flex items-center justify-between gap-4">
          <Button type="submit" size="lg" loading={login.isPending}>
            Sign in
          </Button>
          <Link
            to="/forgot-password"
            className="text-[0.9375rem] text-accent underline-offset-4 hover:underline"
          >
            Forgot password?
          </Link>
        </div>
      </form>
    </AuthLayout>
  );
}
