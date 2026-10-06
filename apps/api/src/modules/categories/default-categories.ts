import type { CategoryType } from '@prisma/client';

export interface DefaultCategory {
  name: string;
  type: CategoryType;
  icon: string;
  color: string;
  children?: { name: string; icon: string }[];
}

/** Starting categories for every new user. They can rename, recolour, archive or add their own. */
export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  {
    name: 'Food',
    type: 'expense',
    icon: 'utensils',
    color: '#b98a2e',
    children: [
      { name: 'Groceries', icon: 'shopping-basket' },
      { name: 'Restaurants', icon: 'utensils' },
      { name: 'Coffee', icon: 'coffee' },
    ],
  },
  {
    name: 'Transport',
    type: 'expense',
    icon: 'car',
    color: '#5b6b84',
    children: [
      { name: 'Taxi', icon: 'car-taxi-front' },
      { name: 'Public transport', icon: 'bus' },
      { name: 'Fuel', icon: 'fuel' },
    ],
  },
  {
    name: 'Housing',
    type: 'expense',
    icon: 'home',
    color: '#1f4e5a',
    children: [
      { name: 'Rent', icon: 'home' },
      { name: 'Utilities', icon: 'plug' },
    ],
  },
  {
    name: 'Entertainment',
    type: 'expense',
    icon: 'clapperboard',
    color: '#85687a',
    children: [
      { name: 'Games', icon: 'gamepad-2' },
      { name: 'Movies', icon: 'film' },
      { name: 'Subscriptions', icon: 'repeat' },
    ],
  },
  { name: 'Shopping', type: 'expense', icon: 'shopping-bag', color: '#b2432b' },
  { name: 'Health', type: 'expense', icon: 'heart-pulse', color: '#6f8f72' },
  { name: 'Education', type: 'expense', icon: 'graduation-cap', color: '#3a3f46' },
  { name: 'Travel', type: 'expense', icon: 'plane', color: '#b9ae94' },
  { name: 'Other', type: 'expense', icon: 'ellipsis', color: '#8a8f97' },
  { name: 'Salary', type: 'income', icon: 'briefcase', color: '#2e6b4b' },
  { name: 'Freelance', type: 'income', icon: 'laptop', color: '#2e6b4b' },
  { name: 'Interest', type: 'income', icon: 'percent', color: '#2e6b4b' },
  { name: 'Gifts', type: 'income', icon: 'gift', color: '#2e6b4b' },
  { name: 'Other income', type: 'income', icon: 'ellipsis', color: '#2e6b4b' },
];
