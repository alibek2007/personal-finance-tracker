import type { ReactNode } from 'react';

export function AuthLayout({
  title,
  intro,
  children,
  footer,
}: {
  title: string;
  intro?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,32rem)]">
      <aside className="hidden flex-col justify-between border-r border-rule p-12 lg:flex">
        <span className="font-display text-3xl font-semibold tracking-tight">Ledger</span>
        <p className="max-w-md font-display text-4xl leading-tight tracking-tight">
          Make your money understandable at a glance.
        </p>
        <p className="text-[0.8125rem] text-muted">
          Your data is private to your account and never shared.
        </p>
      </aside>
      <main id="main" className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <span className="mb-10 font-display text-2xl font-semibold lg:hidden">Ledger</span>
        <h1 className="font-display text-3xl">{title}</h1>
        {intro ? <p className="mt-2 text-muted">{intro}</p> : null}
        <div className="mt-8">{children}</div>
        {footer ? <div className="mt-8 text-[0.9375rem] text-muted">{footer}</div> : null}
      </main>
    </div>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-md border border-loss/40 bg-loss-wash px-3 py-2 text-[0.9375rem] text-loss"
    >
      {message}
    </p>
  );
}
