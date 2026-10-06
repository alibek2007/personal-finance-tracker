import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Avatar, Badge, Button, Field, Input, toast } from '@pfm/ui';
import { changePasswordSchema, nameSchema, type ChangePasswordInput } from '@pfm/validation';
import { z } from 'zod';
import {
  useChangePassword,
  useCurrentUser,
  useLogout,
  useResendVerification,
  useUpdateProfile,
} from '../lib/auth';
import { applyApiError } from '../lib/forms';
import { ApiError } from '../lib/api';
import { FormError } from './auth/AuthLayout';

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-6 border-t border-rule py-8 md:grid-cols-[14rem_minmax(0,1fr)]">
      <div>
        <h2 className="font-display text-xl">{title}</h2>
        <p className="mt-1 text-[0.8125rem] text-muted">{description}</p>
      </div>
      <div>{children}</div>
    </section>
  );
}

const nameFormSchema = z.object({ name: nameSchema });

function NameForm() {
  const user = useCurrentUser();
  const update = useUpdateProfile();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isDirty },
    reset,
  } = useForm<{ name: string }>({
    resolver: zodResolver(nameFormSchema),
    defaultValues: { name: user.name },
  });
  const [formError, setFormError] = useState<string | null>(null);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const { user: saved } = await update.mutateAsync(values);
      reset({ name: saved.name });
      toast.success('Name updated');
    } catch (error) {
      setFormError(applyApiError(error, setError));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex max-w-md flex-col gap-4">
      <FormError message={formError} />
      <Field label="Name" error={errors.name?.message}>
        <Input autoComplete="name" {...register('name')} />
      </Field>
      <Button type="submit" loading={update.isPending} disabled={!isDirty} className="self-start">
        Save name
      </Button>
    </form>
  );
}

function PasswordForm() {
  const change = useChangePassword();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors },
  } = useForm<ChangePasswordInput>({ resolver: zodResolver(changePasswordSchema) });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await change.mutateAsync(values);
      reset();
      toast.success('Password changed. Other devices were signed out.');
    } catch (error) {
      setFormError(applyApiError(error, setError));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex max-w-md flex-col gap-4">
      <FormError message={formError} />
      <Field label="Current password" error={errors.currentPassword?.message}>
        <Input type="password" autoComplete="current-password" {...register('currentPassword')} />
      </Field>
      <Field
        label="New password"
        hint="At least 10 characters. Changing it signs out your other devices."
        error={errors.newPassword?.message}
      >
        <Input type="password" autoComplete="new-password" {...register('newPassword')} />
      </Field>
      <Button type="submit" loading={change.isPending} className="self-start">
        Change password
      </Button>
    </form>
  );
}

export function ProfilePage() {
  const user = useCurrentUser();
  const logout = useLogout();
  const resend = useResendVerification();

  async function sendVerification() {
    try {
      await resend.mutateAsync();
      toast.success(`Confirmation link sent to ${user.email}`);
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.message
          : "Couldn't send the email. Check your connection and try again.",
      );
    }
  }

  return (
    <div>
      <div className="flex items-center gap-4">
        <Avatar name={user.name} className="size-14 text-lg" />
        <div>
          <h1 className="font-display text-4xl">{user.name}</h1>
          <p className="flex items-center gap-2 text-muted">
            {user.email}
            {user.emailVerified ? (
              <Badge tone="gain">✓ Verified</Badge>
            ) : (
              <Badge tone="warn">Not verified</Badge>
            )}
          </p>
        </div>
      </div>

      <div className="mt-8">
        <Section title="Name" description="How Ledger greets you.">
          <NameForm />
        </Section>
        {!user.emailVerified ? (
          <Section
            title="Confirm your email"
            description="Lets you recover your account if you forget your password."
          >
            <Button
              variant="secondary"
              loading={resend.isPending}
              onClick={() => void sendVerification()}
            >
              Send confirmation link
            </Button>
          </Section>
        ) : null}
        <Section title="Password" description="Use something you don't use anywhere else.">
          <PasswordForm />
        </Section>
        <Section title="Session" description="Signing out ends this session on this device.">
          <Button variant="secondary" loading={logout.isPending} onClick={() => logout.mutate()}>
            Sign out
          </Button>
        </Section>
      </div>
    </div>
  );
}
