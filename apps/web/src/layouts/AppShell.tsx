import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Ellipsis, Plus, Search } from 'lucide-react';
import {
  Button,
  CommandMenu,
  Dialog,
  DialogContent,
  Skeleton,
  cn,
  type CommandGroup,
} from '@pfm/ui';
import { format, parseISO } from 'date-fns';
import { formatMoney, money } from '@pfm/finance';
import { NotificationBell } from '../features/notifications/NotificationBell';
import { useCurrentUser } from '../lib/auth';
import { transactionsUrl, useDebounced, useSearch } from '../lib/search';
import { ThemeMenu } from '../components/ThemeMenu';
import { UserMenu } from '../components/UserMenu';
import { useHotkeys, type Hotkey } from '../hooks/use-hotkeys';
import {
  ALL_NAV,
  MOBILE_LEFT,
  MOBILE_RIGHT,
  PRIMARY_NAV,
  SECONDARY_NAV,
  type NavItem,
} from '../routes/nav';

export const ADD_PATH = '/transactions/new';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'relative flex items-center gap-3 rounded-md px-3 py-2 font-medium text-muted transition-colors duration-[var(--dur-micro)] hover:bg-sunk hover:text-ink md:justify-center lg:justify-start',
    isActive && 'bg-accent-wash text-accent hover:bg-accent-wash hover:text-accent',
  );

function SidebarLink({ item }: { item: NavItem }) {
  return (
    <NavLink to={item.to} end={item.end ?? false} className={navLinkClass} title={item.label}>
      <item.icon aria-hidden className="size-[1.125rem] shrink-0" />
      <span className="sr-only lg:not-sr-only">{item.label}</span>
    </NavLink>
  );
}

function MobileLink({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.to}
      end={item.end ?? false}
      className={({ isActive }) =>
        cn(
          'flex h-16 flex-col items-center justify-center gap-0.5 text-[0.6875rem] font-medium text-muted',
          isActive && 'text-accent',
        )
      }
    >
      <item.icon aria-hidden className="size-5" />
      {item.shortLabel ?? item.label}
    </NavLink>
  );
}

/** "Budgets · Ledger": each screen has its own title, so history, tabs and screen readers can tell them apart. */
function titleFor(pathname: string): string {
  const match = [...ALL_NAV]
    .sort((a, b) => b.to.length - a.to.length)
    .find((item) => (item.to === '/' ? pathname === '/' : pathname.startsWith(item.to)));
  if (pathname.startsWith('/transactions/new')) return 'Add transaction · Ledger';
  if (pathname.endsWith('/edit')) return 'Edit transaction · Ledger';
  return match ? `${match.label} · Ledger` : 'Ledger';
}

export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  // Compared by value rather than "is this the first run", so React StrictMode's repeated effects are harmless.
  const shownPath = useRef(location.pathname);

  // On a screen change: set the title, and move focus to the content so keyboard and screen-reader users
  // start at the top of the new screen instead of wherever the old link was. If the new screen already
  // focused something itself (a form's first field), leave that alone.
  useEffect(() => {
    document.title = titleFor(location.pathname);
    if (shownPath.current === location.pathname) return;
    shownPath.current = location.pathname;
    const main = mainRef.current;
    if (main && !main.contains(document.activeElement)) main.focus({ preventScroll: true });
  }, [location.pathname]);
  const [commandOpen, setCommandOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const user = useCurrentUser();
  const [query, setQuery] = useState('');
  const search = useSearch(useDebounced(query), commandOpen);

  const hotkeys = useMemo<Hotkey[]>(
    () => [
      { key: 'n', handler: () => navigate(ADD_PATH) },
      { key: '/', handler: () => setCommandOpen(true) },
      { key: 'k', mod: true, handler: () => setCommandOpen((open) => !open) },
    ],
    [navigate],
  );
  useHotkeys(hotkeys);

  const searchGroups = useMemo<CommandGroup[]>(() => {
    const r = search.data;
    if (!r || query.trim().length < 2) return [];
    const money$ = (minor: number, currency: typeof user.currency) =>
      formatMoney(money(minor, currency), { locale: user.locale });
    const groups: CommandGroup[] = [];
    const seeAll = transactionsUrl(r.transactionFilter, user.currency);
    if (r.transactions.items.length > 0) {
      groups.push({
        heading: 'Transactions',
        ...(r.understood.length > 0 ? { note: `Understood: ${r.understood.join(' · ')}` } : {}),
        items: [
          ...r.transactions.items.map((t) => ({
            id: `tx-${t.id}`,
            label: t.description,
            detail: `${format(parseISO(t.date), 'MMM d')} · ${money$(t.amount, t.currency)}`,
            alwaysShow: true,
            onSelect: () => navigate(`/transactions/${t.id}/edit`),
          })),
          ...(r.transactions.total > r.transactions.items.length
            ? [
                {
                  id: 'tx-all',
                  label: `See all ${r.transactions.total} matching transactions`,
                  alwaysShow: true,
                  onSelect: () => navigate(seeAll),
                },
              ]
            : []),
        ],
      });
    }
    const others: CommandGroup[] = [
      {
        heading: 'Accounts',
        items: r.accounts.map((a) => ({
          id: `acc-${a.id}`,
          label: a.name,
          detail: money$(a.balance, a.currency),
          alwaysShow: true,
          onSelect: () => navigate('/accounts'),
        })),
      },
      {
        heading: 'Categories',
        items: r.categories.map((c) => ({
          id: `cat-${c.id}`,
          label: c.parentName ? `${c.parentName} › ${c.name}` : c.name,
          detail: 'View transactions',
          alwaysShow: true,
          onSelect: () => navigate(`/transactions?category=${c.id}`),
        })),
      },
      {
        heading: 'Goals',
        items: r.goals.map((g) => ({
          id: `goal-${g.id}`,
          label: g.name,
          alwaysShow: true,
          onSelect: () => navigate('/goals'),
        })),
      },
      {
        heading: 'Recurring',
        items: r.recurring.map((x) => ({
          id: `rec-${x.id}`,
          label: x.description,
          detail: money$(x.amount, x.currency),
          alwaysShow: true,
          onSelect: () => navigate('/recurring'),
        })),
      },
    ];
    return [...groups, ...others.filter((g) => g.items.length > 0)];
  }, [search.data, query, navigate, user]);

  const commandGroups = useMemo<CommandGroup[]>(
    () => [
      ...searchGroups,
      {
        heading: 'Actions',
        items: [
          {
            id: 'add',
            label: 'Add transaction',
            icon: <Plus />,
            hint: 'N',
            keywords: ['new', 'expense', 'income'],
            onSelect: () => navigate(ADD_PATH),
          },
        ],
      },
      {
        heading: 'Go to',
        items: ALL_NAV.map((item) => ({
          id: item.to,
          label: item.label,
          icon: <item.icon />,
          ...(item.keywords ? { keywords: item.keywords } : {}),
          onSelect: () => navigate(item.to),
        })),
      },
    ],
    [navigate, searchGroups],
  );

  const pick = (paths: string[]) => PRIMARY_NAV.filter((item) => paths.includes(item.to));
  const moreItems = [
    ...PRIMARY_NAV.filter((i) => ![...MOBILE_LEFT, ...MOBILE_RIGHT].includes(i.to)),
    ...SECONDARY_NAV,
  ];
  const moreActive = moreItems.some((i) => location.pathname.startsWith(i.to));

  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-accent-ink"
      >
        Skip to content
      </a>

      {/* Desktop sidebar / tablet icon rail */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-16 flex-col border-r border-rule bg-bg px-2 py-5 md:flex lg:w-58 lg:px-3">
        <div className="mb-6 px-1 text-center lg:px-3 lg:text-left">
          <span className="font-display text-2xl font-semibold tracking-tight" aria-label="Ledger">
            L<span className="hidden lg:inline">edger</span>
          </span>
        </div>
        <nav aria-label="Main" className="flex flex-1 flex-col gap-0.5">
          {PRIMARY_NAV.map((item) => (
            <SidebarLink key={item.to} item={item} />
          ))}
        </nav>
        <nav aria-label="Account" className="flex flex-col gap-0.5 border-t border-rule pt-3">
          {SECONDARY_NAV.map((item) => (
            <SidebarLink key={item.to} item={item} />
          ))}
          <div className="mt-2 flex justify-center lg:justify-start lg:px-2">
            <ThemeMenu />
          </div>
        </nav>
      </aside>

      <div className="md:pl-16 lg:pl-58">
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-rule bg-bg/90 px-4 py-3 backdrop-blur md:px-8">
          <span className="font-display text-xl font-semibold md:hidden">Ledger</span>
          <button
            type="button"
            onClick={() => setCommandOpen(true)}
            className="ml-auto flex h-10 items-center gap-2 rounded-md border border-rule-strong bg-sunk px-3 text-muted transition-colors hover:border-ink/40 md:ml-0 md:w-72"
          >
            <Search aria-hidden className="size-4" />
            <span className="hidden flex-1 text-left md:inline">Search or jump to…</span>
            <span className="sr-only md:hidden">Search</span>
            <kbd className="hidden rounded-sm border border-rule px-1.5 text-xs md:inline">/</kbd>
          </button>
          <div className="ml-auto hidden md:block">
            <Button onClick={() => navigate(ADD_PATH)}>
              <Plus aria-hidden /> Add transaction
              <kbd className="ml-1 rounded-sm bg-white/15 px-1.5 text-xs">N</kbd>
            </Button>
          </div>
          <NotificationBell />
          <div className="md:hidden">
            <ThemeMenu />
          </div>
          <UserMenu />
        </header>

        <main
          id="main"
          ref={mainRef}
          tabIndex={-1}
          className="mx-auto w-full max-w-6xl px-4 pb-32 pt-6 outline-none md:px-8 md:pb-16 md:pt-10"
        >
          <Suspense
            fallback={
              <div role="status" aria-label="Loading page" className="space-y-4">
                <Skeleton className="h-10 w-72" />
                <Skeleton className="h-40 w-full" />
              </div>
            }
          >
            <div
              key={location.pathname}
              style={{ animation: 'pfm-rise var(--dur-panel) var(--ease-out)' }}
            >
              <Outlet />
            </div>
          </Suspense>
        </main>
      </div>

      {/* Mobile bottom bar: Home · Activity · [Add] · Analytics · More */}
      <nav
        aria-label="Main, mobile"
        className="pb-safe fixed inset-x-0 bottom-0 z-20 border-t border-rule bg-bg/95 backdrop-blur md:hidden"
      >
        <ul className="mx-auto grid h-16 max-w-md grid-cols-5 items-center">
          {pick(MOBILE_LEFT).map((item) => (
            <li key={item.to}>
              <MobileLink item={item} />
            </li>
          ))}
          <li className="flex justify-center">
            <NavLink
              to={ADD_PATH}
              aria-label="Add transaction"
              className="-mt-6 flex size-14 items-center justify-center rounded-full bg-accent text-accent-ink shadow-float transition-transform active:scale-95"
            >
              <Plus aria-hidden className="size-7" />
            </NavLink>
          </li>
          {pick(MOBILE_RIGHT).map((item) => (
            <li key={item.to}>
              <MobileLink item={item} />
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-haspopup="dialog"
              className={cn(
                'flex h-16 w-full flex-col items-center justify-center gap-0.5 text-[0.6875rem] font-medium text-muted',
                moreActive && 'text-accent',
              )}
            >
              <Ellipsis aria-hidden className="size-5" />
              More
            </button>
          </li>
        </ul>
      </nav>

      <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
        <DialogContent title="More" description="Everything else in Ledger">
          <nav aria-label="More destinations" className="grid grid-cols-2 gap-1">
            {moreItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setMoreOpen(false)}
                className={navLinkClass}
              >
                <item.icon aria-hidden className="size-5" />
                {item.label}
              </NavLink>
            ))}
          </nav>
        </DialogContent>
      </Dialog>

      <CommandMenu
        open={commandOpen}
        onOpenChange={(open) => {
          setCommandOpen(open);
          if (!open) setQuery('');
        }}
        groups={commandGroups}
        query={query}
        onQueryChange={setQuery}
        busy={search.isFetching}
        placeholder="Search, or try “expenses over $50 last month”"
      />
    </div>
  );
}
