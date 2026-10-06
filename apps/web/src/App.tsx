import { lazy, type ComponentType } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { PublicOnly, RequireAuth } from './components/RequireAuth';
import { AppShell } from './layouts/AppShell';
import { ForgotPasswordPage, ResetPasswordPage, VerifyEmailPage } from './pages/auth/PasswordPages';
import { LoginPage } from './pages/auth/LoginPage';
import { RegisterPage } from './pages/auth/RegisterPage';

/**
 * Signed-in screens load on demand: the first paint ships only the shell and sign-in, and the charting
 * library arrives with the first screen that draws a chart.
 */
function page<N extends string>(load: () => Promise<Record<N, ComponentType>>, name: N) {
  return lazy(() => load().then((m) => ({ default: m[name] })));
}

const DashboardPage = page(() => import('./features/dashboard/DashboardPage'), 'DashboardPage');
const AnalyticsPage = page(() => import('./features/analytics/AnalyticsPage'), 'AnalyticsPage');
const BudgetsPage = page(() => import('./features/budgets/BudgetsPage'), 'BudgetsPage');
const GoalsPage = page(() => import('./features/goals/GoalsPage'), 'GoalsPage');
const AccountsPage = page(() => import('./features/accounts/AccountsPage'), 'AccountsPage');
const TransactionsPage = page(
  () => import('./features/transactions/TransactionsPage'),
  'TransactionsPage',
);
const CalendarPage = page(() => import('./features/calendar/CalendarPage'), 'CalendarPage');
const NotificationsPage = page(
  () => import('./features/notifications/NotificationsPage'),
  'NotificationsPage',
);
const RecurringPage = page(() => import('./features/recurring/RecurringPage'), 'RecurringPage');
const ProfilePage = page(() => import('./pages/ProfilePage'), 'ProfilePage');
const SettingsPage = page(() => import('./pages/SettingsPage'), 'SettingsPage');
const AddTransactionPage = page(
  () => import('./features/transactions/TransactionEditorPages'),
  'AddTransactionPage',
);
const EditTransactionPage = page(
  () => import('./features/transactions/TransactionEditorPages'),
  'EditTransactionPage',
);
const DesignSystemPage = page(() => import('./pages/DesignSystemPage'), 'DesignSystemPage');

/** Routes only; the router itself is provided by the caller (BrowserRouter in main, MemoryRouter in tests). */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<PublicOnly />}>
        <Route path="login" element={<LoginPage />} />
        <Route path="register" element={<RegisterPage />} />
        <Route path="forgot-password" element={<ForgotPasswordPage />} />
        <Route path="reset-password" element={<ResetPasswordPage />} />
      </Route>
      {/* Emailed links can be opened signed in or out. */}
      <Route path="verify-email" element={<VerifyEmailPage />} />

      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="transactions" element={<TransactionsPage />} />
          <Route path="transactions/new" element={<AddTransactionPage />} />
          <Route path="transactions/:id/edit" element={<EditTransactionPage />} />
          <Route path="accounts" element={<AccountsPage />} />
          <Route path="budgets" element={<BudgetsPage />} />
          <Route path="goals" element={<GoalsPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="recurring" element={<RecurringPage />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="profile" element={<ProfilePage />} />
          {import.meta.env.DEV ? <Route path="design" element={<DesignSystemPage />} /> : null}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Route>
    </Routes>
  );
}
