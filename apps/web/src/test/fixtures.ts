import type { AccountDto, CategoryDto, TransactionDto } from '@pfm/validation';
import type { Handler } from './utils';
import { signedIn } from './utils';

export const checking: AccountDto = {
  id: 'acc-chk',
  name: 'Checking',
  type: 'bank',
  institution: 'Northwind',
  currency: 'USD',
  initialBalance: 300000,
  currentBalance: 432000,
  color: '#1f4e5a',
  icon: 'landmark',
  isArchived: false,
};
export const savings: AccountDto = {
  id: 'acc-sav',
  name: 'Savings',
  type: 'savings',
  institution: null,
  currency: 'USD',
  initialBalance: 700000,
  currentBalance: 850000,
  color: '#2e6b4b',
  icon: 'piggy-bank',
  isArchived: false,
};
export const visa: AccountDto = {
  id: 'acc-visa',
  name: 'Visa',
  type: 'credit_card',
  institution: null,
  currency: 'USD',
  initialBalance: 0,
  currentBalance: -82000,
  color: '#b2432b',
  icon: 'credit-card',
  isArchived: false,
};
export const tenge: AccountDto = {
  id: 'acc-kzt',
  name: 'Tenge',
  type: 'bank',
  institution: null,
  currency: 'KZT',
  initialBalance: 0,
  currentBalance: 5_000_000,
  color: '#5b6b84',
  icon: 'landmark',
  isArchived: false,
};

const cat = (
  id: string,
  name: string,
  type: 'income' | 'expense',
  parentId: string | null = null,
): CategoryDto => ({
  id,
  name,
  type,
  parentId,
  icon: 'tag',
  color: '#b98a2e',
  isDefault: true,
  isArchived: false,
});
export const categories: CategoryDto[] = [
  cat('c-food', 'Food', 'expense'),
  cat('c-coffee', 'Coffee', 'expense', 'c-food'),
  cat('c-groc', 'Groceries', 'expense', 'c-food'),
  cat('c-rent', 'Rent', 'expense'),
  cat('c-salary', 'Salary', 'income'),
];

export const tx = (over: Partial<TransactionDto> & { id: string }): TransactionDto => ({
  type: 'expense',
  accountId: checking.id,
  categoryId: null,
  amount: 1000,
  currency: 'USD',
  transferAccountId: null,
  transferAmount: null,
  isRefund: false,
  description: 'Thing',
  merchant: null,
  date: '2026-03-04',
  notes: null,
  isRecurring: false,
  createdAt: '2026-03-04T10:00:00.000Z',
  ...over,
});

export const sampleTransactions: TransactionDto[] = [
  tx({
    id: 't1',
    type: 'income',
    amount: 480000,
    categoryId: 'c-salary',
    description: 'Salary',
    merchant: 'Acme Corp',
    date: '2026-03-04',
  }),
  tx({
    id: 't2',
    amount: 1850,
    categoryId: 'c-coffee',
    description: 'Latte',
    merchant: 'Blue Bottle',
    date: '2026-03-03',
  }),
  tx({
    id: 't3',
    type: 'transfer',
    amount: 50000,
    accountId: checking.id,
    transferAccountId: savings.id,
    transferAmount: 50000,
    description: 'Monthly savings',
    date: '2026-03-02',
  }),
];

export function totalsFor(accounts: AccountDto[]) {
  const byCurrency = new Map<string, { assets: number; debts: number }>();
  for (const a of accounts) {
    const t = byCurrency.get(a.currency) ?? { assets: 0, debts: 0 };
    if (a.currentBalance >= 0) t.assets += a.currentBalance;
    else t.debts += -a.currentBalance;
    byCurrency.set(a.currency, t);
  }
  return [...byCurrency].map(([currency, t]) => ({ currency, ...t, netWorth: t.assets - t.debts }));
}

/** Handlers for the read endpoints every ledger screen uses. */
export function ledgerHandlers(
  opts: {
    accounts?: AccountDto[];
    transactions?: TransactionDto[];
    suggestions?: object[];
  } = {},
): Record<string, Handler> {
  const accounts = opts.accounts ?? [checking, savings, visa];
  const transactions = opts.transactions ?? sampleTransactions;
  return {
    ...signedIn(),
    'GET /accounts?includeArchived=true': () => ({
      json: { accounts, totals: totalsFor(accounts) },
    }),
    'GET /categories?includeArchived=true': () => ({ json: { categories } }),
    'GET /transactions/suggestions': () => ({ json: { suggestions: opts.suggestions ?? [] } }),
    'GET /transactions': () => ({
      json: { items: transactions, total: transactions.length, page: 1, pageSize: 25 },
    }),
  };
}
