import { z } from 'zod';
import { currencySchema, timezoneSchema } from './common';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address')
  .max(254);

/** NIST-style: length over composition rules. */
export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128, 'Use at most 128 characters');

export const nameSchema = z.string().trim().min(1, 'Tell us what to call you').max(80);

export const registerSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  currency: currencySchema.default('USD'),
  timezone: timezoneSchema.default('UTC'),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password').max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const userSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  avatar: z.string().nullable(),
  currency: currencySchema,
  timezone: z.string(),
  locale: z.string(),
  emailVerified: z.boolean(),
});
export type UserDto = z.infer<typeof userSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password').max(128),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const passwordResetRequestSchema = z.object({ email: emailSchema });
export type PasswordResetRequestInput = z.infer<typeof passwordResetRequestSchema>;

export const passwordResetSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});
export type PasswordResetInput = z.infer<typeof passwordResetSchema>;

export const verifyEmailSchema = z.object({ token: z.string().min(20).max(200) });

export const updateProfileSchema = z
  .object({
    name: nameSchema,
    currency: currencySchema,
    timezone: timezoneSchema,
    locale: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/, 'Use a locale like en-US'),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Change at least one field');
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
