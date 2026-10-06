/** Shared enums mirrored from the Prisma schema, usable in the browser (no Prisma import). */
export const ACCOUNT_TYPES = [
  'cash',
  'bank',
  'savings',
  'credit_card',
  'investment',
  'other',
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const TRANSACTION_TYPES = ['income', 'expense', 'transfer'] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const CATEGORY_TYPES = ['income', 'expense'] as const;
export type CategoryType = (typeof CATEGORY_TYPES)[number];

export const BUDGET_PERIODS = ['weekly', 'monthly', 'yearly'] as const;
export type BudgetPeriod = (typeof BUDGET_PERIODS)[number];

export const FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export type { UserDto, RegisterInput, LoginInput } from '@pfm/validation';
export type {
  ChangePasswordInput,
  PasswordResetInput,
  PasswordResetRequestInput,
  UpdateProfileInput,
} from '@pfm/validation';
