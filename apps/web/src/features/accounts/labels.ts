import type { AccountDto } from '@pfm/validation';

export const ACCOUNT_TYPE_LABELS: Record<AccountDto['type'], string> = {
  cash: 'Cash',
  bank: 'Bank account',
  savings: 'Savings',
  credit_card: 'Credit card',
  investment: 'Investment',
  other: 'Other',
};
