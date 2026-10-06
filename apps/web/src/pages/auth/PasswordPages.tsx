import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Field, Input } from '@pfm/ui';
import {
  passwordResetRequestSchema,
  passwordSchema,
  type PasswordResetRequestInput,
} from '@pfm/validation';
import { z } from 'zod';
import { useRequestPasswordReset, useResetPassword, useVerifyEmail } from '../../lib/auth';
import { applyApiError } from '../../lib/forms';
import { AuthLayout, FormError } from './AuthLayout';

const backToSignIn = (
  <Link to="/login" className="font-medium text-accent underline-offset-4 hover:underline">
    Back to sign in
  </Link>
);

export function ForgotPasswordPage() {
  const request = useRequestPasswordReset();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<PasswordResetRequestInput>({ resolver: zodResolver(passwordResetRequestSchema) });

  const onSubmit = handleSubmit(async ({ email }) => {
    setFormError(null);
    try {
      await request.mutateAsync(email);
      setSentTo(email);
    } catch (error) {
      setFormError(applyApiError(error, setError));
    }
  });

  if (sentTo) {
    return (
      <AuthLayout title="Check your email" footer={backToSignIn}>
        <p role="status">
          If an account exists for <strong>{sentTo}</strong>, we've sent a link to choose a new
          password. It works once and expires in an hour.
        </p>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout
      title="Reset your password"
      intro="Enter your email and we'll send you a link to choose a new one."
      footer={backToSignIn}
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <FormError message={formError} />
        <Field label="Email" error={errors.email?.message}>
          <Input type="email" autoComplete="email" autoFocus {...register('email')} />
        </Field>
        <Button type="submit" size="lg" loading={request.isPending} className="self-start">
          Send reset link
        </Button>
      </form>
    </AuthLayout>
  );
}

const resetFormSchema = z.object({ password: passwordSchema });

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const reset = useResetPassword();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<{ password: string }>({ resolver: zodResolver(resetFormSchema) });

  const onSubmit = handleSubmit(async ({ password }) => {
    setFormError(null);
    try {
      await reset.mutateAsync({ token, password });
      navigate('/login', {
        replace: true,
        state: { notice: 'Password updated. Sign in with your new password.' },
      });
    } catch (error) {
      setFormError(applyApiError(error, setError));
    }
  });

  if (!token) {
    return (
      <AuthLayout title="This link is incomplete" footer={backToSignIn}>
        <p>
          The reset link is missing its token. Open the link from your email again, or{' '}
          <Link to="/forgot-password" className="text-accent underline">
            request a new one
          </Link>
          .
        </p>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="Choose a new password" footer={backToSignIn}>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <FormError message={formError} />
        <Field label="New password" hint="At least 10 characters." error={errors.password?.message}>
          <Input type="password" autoComplete="new-password" autoFocus {...register('password')} />
        </Field>
        <Button type="submit" size="lg" loading={reset.isPending} className="self-start">
          Save new password
        </Button>
      </form>
    </AuthLayout>
  );
}

/** Reachable signed in or out: the emailed link may be opened on any device. */
export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const verify = useVerifyEmail();
  const started = useRef(false);

  useEffect(() => {
    // Single-use token: guard so StrictMode's double effect can't consume it twice.
    if (!token || started.current) return;
    started.current = true;
    verify.mutate(token);
  }, [token, verify]);

  return (
    <AuthLayout
      title="Confirming your email"
      footer={
        <Link to="/" className="font-medium text-accent underline">
          Go to Ledger
        </Link>
      }
    >
      <div role="status" aria-live="polite">
        {!token ? (
          <p>This link is missing its token. Open the link from your email again.</p>
        ) : verify.isSuccess ? (
          <p>Thanks, your email is confirmed.</p>
        ) : verify.isError ? (
          <p className="text-loss">{verify.error.message}</p>
        ) : (
          <p className="text-muted">One moment…</p>
        )}
      </div>
    </AuthLayout>
  );
}
