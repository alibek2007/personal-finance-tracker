import {
  BarChart3,
  Bell,
  CalendarDays,
  Home,
  Landmark,
  PiggyBank,
  Repeat,
  Settings,
  Target,
  User,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  /** Short label for the cramped mobile bottom bar. */
  shortLabel?: string;
  icon: LucideIcon;
  /** Extra search terms for the command menu. */
  keywords?: string[];
  end?: boolean;
}

/** Main destinations, in sidebar order. */
export const PRIMARY_NAV: NavItem[] = [
  {
    to: '/',
    label: 'Dashboard',
    shortLabel: 'Home',
    icon: Home,
    end: true,
    keywords: ['home', 'overview'],
  },
  {
    to: '/transactions',
    label: 'Transactions',
    shortLabel: 'Activity',
    icon: Wallet,
    keywords: ['spending', 'income', 'history'],
  },
  {
    to: '/accounts',
    label: 'Accounts',
    icon: Landmark,
    keywords: ['bank', 'cash', 'balance', 'net worth'],
  },
  { to: '/budgets', label: 'Budgets', icon: PiggyBank, keywords: ['limits', 'spending'] },
  { to: '/goals', label: 'Goals', icon: Target, keywords: ['savings', 'save'] },
  {
    to: '/analytics',
    label: 'Analytics',
    icon: BarChart3,
    keywords: ['charts', 'trends', 'reports'],
  },
  { to: '/recurring', label: 'Recurring', icon: Repeat, keywords: ['subscriptions', 'bills'] },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays, keywords: ['upcoming', 'bills'] },
];

export const SECONDARY_NAV: NavItem[] = [
  { to: '/notifications', label: 'Notifications', icon: Bell },
  { to: '/settings', label: 'Settings', icon: Settings, keywords: ['theme', 'currency'] },
  { to: '/profile', label: 'Profile', icon: User, keywords: ['account', 'name'] },
];

export const ALL_NAV = [...PRIMARY_NAV, ...SECONDARY_NAV];

/** Pinned to the mobile bottom bar; the Add button sits between the two groups. */
export const MOBILE_LEFT = ['/', '/transactions'];
export const MOBILE_RIGHT = ['/analytics'];
