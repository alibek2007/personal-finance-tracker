import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Field, Input, Select } from '@pfm/ui';
import { CURRENCIES, CURRENCY_CODES } from '@pfm/finance';
import type { z } from 'zod';
import { registerSchema, type RegisterInput } from '@pfm/validation';
import { useRegister } from '../../lib/auth';
import { applyApiError } from '../../lib/forms';
import { AuthLayout, FormError } from './AuthLayout';

/** The browser already knows the user's timezone; no need to ask. */
const detectedTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

export function RegisterPage() {
  const navigate = useNavigate();
  const signUp = useRegister();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<z.input<typeof registerSchema>, unknown, RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { currency: 'USD', timezone: detectedTimezone() },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await signUp.mutateAsync(values);
      navigate('/', { replace: true });
    } catch (error) {
      setFormError(applyApiError(error, setError));
    }
  });

  return (
    <AuthLayout
      title="Create your account"
      intro="It takes about a minute. You can change everything later."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-accent underline-offset-4 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <FormError message={formError} />
        <Field label="Your name" error={errors.name?.message}>
          <Input autoComplete="name" autoFocus {...register('name')} />
        </Field>
        <Field label="Email" error={errors.email?.message}>
          <Input type="email" autoComplete="email" {...register('email')} />
        </Field>
        <Field
          label="Password"
          hint="At least 10 characters. A few random words make a strong password."
          error={errors.password?.message}
        >
          <Input type="password" autoComplete="new-password" {...register('password')} />
        </Field>
        <Field
          label="Main currency"
          hint="Used for your totals. Individual accounts can use other currencies."
          error={errors.currency?.message}
        >
          <Select {...register('currency')}>
            {CURRENCY_CODES.map((code) => (
              <option key={code} value={code}>
                {code} · {CURRENCIES[code].name}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit" size="lg" loading={signUp.isPending} className="self-start">
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
