# Architecture

## Environment findings (Phase 0)

- Repository was empty (greenfield). Node 24, npm 11, git available. **No pnpm, Docker, or PostgreSQL** on the dev machine.
- Decisions that follow:
  - **npm workspaces** (no extra tooling to install) instead of pnpm.
  - **PostgreSQL stays the only database.** For local dev/test without Docker we ship `embedded-postgres` (real PG binaries, started by `npm run db:dev`). `docker-compose.yml` is provided for anyone with Docker; any `DATABASE_URL` works.
  - **Prisma 6** (stable `prisma-client-js`), not 7, to avoid mandatory driver-adapter plumbing.

## Monorepo

```
apps/
  api/        Fastify + Prisma REST API (modules → service → repository)
  web/        React + Vite + Tailwind SPA
packages/
  finance/    Money + all pure financial calculations (shared FE/BE, zero deps)
  validation/ Zod schemas shared by API (request/response) and web (forms)
  types/      Shared TS types / enums derived from validation
  ui/         Design system components (created in Phase 2)
docs/
```

`packages/finance` is an addition to the brief's package list. It exists to satisfy "do not duplicate business logic between frontend and backend": balances, budgets, projections, goals and recurring math live there once, are tested once, and are imported by both sides.

Shared TS/ESLint/Prettier config lives at the repo root (`tsconfig.base.json`, `eslint.config.js`), so a separate `packages/config` would only add indirection.

Shared packages export TypeScript source directly (`exports` → `src/index.ts`). Vite and tsx consume them natively; the API bundle (tsup) inlines them. No build step for libraries during development.

## Layering (API)

```
route (HTTP, Zod validation, auth)  →  service (use-cases, transactions)
   →  repository (Prisma, always user-scoped)  →  PostgreSQL
                 ↘ @pfm/finance (pure calculations)
```

- **Routes** only parse/validate and call services. No business logic.
- **Services** orchestrate; own DB transactions (e.g. create transaction + update balance + audit log atomically).
- **Repositories** are the only place Prisma is touched. Every method takes `userId` as its first argument and includes it in the `where` clause. Cross-tenant access is impossible by construction and covered by integration tests.
- **@pfm/finance** is pure and deterministic: no Date.now(), no I/O. "Now" and timezone are injected.

## Money

- All amounts are **integer minor units** (cents). DB column `BIGINT`, API JSON number (safe integer enforced), UI formats via `formatMoney`.
- No floats in calculations. Fractional factors (percent, FX, proration) go through exact BigInt rational arithmetic with explicit rounding.
- Every amount carries a currency; mixing currencies throws. Cross-currency aggregation requires an explicit FX rate (future); until then, reports are computed per currency and the user's base currency is used for dashboard totals, with a visible notice if other currencies exist.

## Balances

`Account.currentBalance` is a **denormalised cache** maintained in the same DB transaction as every transaction write, and verifiable: `initialBalance + Σ signed(transactions)`. A `reconcile` service recomputes and reports drift; tests assert cache == recomputed value after create/edit/delete/transfer.

Signed effect on an account:

| type     | source account | destination account                         |
| -------- | -------------- | ------------------------------------------- |
| income   | +amount        | –                                           |
| expense  | −amount        | –                                           |
| transfer | −amount        | +toAmount (equals amount for same currency) |

Credit cards store a **negative balance for debt**. Net worth = Σ balances of non-archived-or-nonzero accounts, so debt reduces net worth. Expenses on a card push the balance more negative; payments are transfers from checking → card.

Transfers are a single row (`type=transfer`, `accountId`, `transferAccountId`, `transferAmount`), never counted as income or expense in analytics. Refunds are `income` rows with `isRefund=true` and the original expense category; spending analytics net them against that category.

## Authentication & security

- Email + password, hashed with **Argon2id** (`@node-rs/argon2`).
- **Server-side sessions**: opaque 256-bit random token in an `HttpOnly; Secure (prod); SameSite=Lax` cookie; only the SHA-256 of the token is stored (`Session` table). Sliding expiry, revocation on logout/password change. No tokens in localStorage.
- **CSRF**: SameSite=Lax cookie + required custom header (`X-Requested-With: pfm`) and `Origin` check on all unsafe methods; double-submit token endpoint reserved for cross-site deployments.
- Rate limiting (global + strict on auth routes), Helmet headers, strict CORS allowlist from env, Zod on every body/query/param, response serialisation through schemas.
- Email verification and password reset use hashed single-use tokens (`AuthToken` table) with expiry; email delivery is behind a `Mailer` interface (console in dev).
- `AuditLog` for login, logout, password change, export, import, delete.
- Logger redaction for `authorization`, `cookie`, `password*`, `token*`.

## Frontend

- React Router (data router), TanStack Query for server state, React Hook Form + Zod resolvers using shared schemas.
- Feature folders (`features/transactions`, `features/budgets`, …) each owning api hooks, components, and pages; `components/` is for cross-feature primitives; the design system lives in `packages/ui`.
- Optimistic updates for transaction create/delete/category assignment with rollback + toast on error.
- Mobile uses a distinct shell (bottom bar with prominent Add, bottom-sheet forms); desktop uses sidebar + dialogs.

## Search

`GET /api/transactions?q=` parses a small query grammar in one place (`parseSearchQuery`) into a typed `TransactionFilter` (text, amount bounds from "over $100", month names). The interface `SearchInterpreter` lets a natural-language/LLM implementation be swapped in later without touching routes.

## Testing

- Vitest everywhere. `@pfm/finance` is tested exhaustively (property-style invariants for money). API integration tests run against a real PostgreSQL schema per test file. React Testing Library for components. Playwright E2E + screenshot QA in Phase 12.

## Deployment

Provider-independent: API ships as a Node bundle + Dockerfile; web as static assets; config entirely via env (`.env.example`). Prisma `migrate deploy` on release.

## Authentication (implemented in Phase 3)

- **Endpoints:** register, login, logout, change-password, email verification (request + confirm), password reset (request + confirm), `GET/PATCH /api/me`.
- **Cookie:** `pfm_session`, signed, `HttpOnly`, `SameSite=Lax`, `Secure` when `COOKIE_SECURE=true` (enforced in production). Verified in a browser: not readable from JavaScript, and `localStorage` holds only the theme preference.
- **Sliding sessions** (30 days default), revoked on logout; password change signs out every _other_ device; password reset signs out all devices.
- **No account enumeration on sign-in or reset:** wrong password and unknown email return the same message, and an equalising hash runs for unknown emails. Password-reset requests always answer the same. _Registration does say when an email is taken_ (a standard usability trade-off); it is rate-limited per IP+email.
- **Rate limits:** `AUTH_RATE_LIMIT_MAX` per minute per IP+email on sign-in, sign-up and reset; stricter (3-5/min) on change-password and resend-verification.
- **One-time tokens** (verify/reset) are hashed, expire (24 h / 1 h), are consumed atomically and re-issuing invalidates the previous one.
- **Mailer:** behind an interface. The fallback console transport logs bodies only outside production, because the links are credentials. **A real provider must be configured before launch.**
- **Audit log:** register, login, failed login, logout, password change/reset, email verified, profile update. No secrets in metadata (asserted in tests).
- **Web:** session state is a TanStack Query (`['me']`); `RequireAuth` guards the app, `PublicOnly` bounces signed-in users (honouring the originally requested page). Any 401 anywhere clears the cached user, and sign-out purges all cached data.

## Test isolation

API integration tests run against real PostgreSQL. `test/global-setup.ts` migrates one template database; `test/setup.ts` clones it into a private database for every test file (`CREATE DATABASE … TEMPLATE …`) and drops it afterwards, so files run in parallel and can never see each other's rows. (An earlier shared-database design failed about one run in five because Vitest ignores `fileParallelism: false` in per-project config; this was found by repeated runs, not by luck.) With `TEST_DATABASE_URL` set, the role needs `CREATEDB`.

## Ledger (implemented in Phase 4)

- **One write path.** `TransactionsService` is the only code that changes a balance. Create / edit / delete compute the exact balance deltas with the pure functions in `@pfm/finance` (`ledgerEffects`, `editEffects`, `deleteEffects`) and apply them with atomic `increment` inside the same database transaction as the row change. Concurrent writes cannot lose updates (tested with 25 parallel requests).
- **The cache is provable.** `POST /api/accounts/reconcile` recomputes every balance from opening balance + transactions and reports drift. The seed script and the integration tests assert it is empty after creates, edits (amount, account, type), deletes, bulk deletes, transfers, cross-currency transfers and refunds.
- **Rules live in one place** (`validateLedgerTx`): amounts are positive whole minor units; category kind must match (a refund is income in an _expense_ category); transfers need two different accounts, no category, and an explicit arriving amount when currencies differ; archived accounts/categories cannot be newly selected but history stays editable.
- **Explicit input is never silently dropped.** Sending a category with a transfer is a 400. Only fields merely _inherited_ from the old type are cleared when an edit changes the type.
- **Net worth** = assets - debts per currency (`summarizeBalances`); currencies are never added together. Credit cards hold negative balances; paying one from checking is a transfer and leaves net worth unchanged.
- **Accounts with history cannot be deleted** (409, "archive instead"); categories with history require a reassignment target.
- **Tenant isolation.** Every query includes `userId`. Another user's id in a URL or body returns 404 (reads/writes) or a field-level 400 (references), never a distinguishable "exists but not yours". Covered by a dedicated isolation test that attempts every read/write/reference route.
- **Smart entry.** `GET /api/transactions/suggestions` returns the most repeated (account, category, description) combinations from the last 90 days; the form shows them as one-tap chips.

## Reports and the dashboard (implemented in Phase 5)

- **One calculation, shared.** `@pfm/finance` owns period math (`periods`), aggregation (`reports`) and insight rules (`insights`). The API composes them; the browser only formats. The cash-flow chart's totals are asserted equal to the headline figures for the same dates.
- **"Today" is the user's.** Reports use the calendar date in the user's timezone (`todayInZone`), and the UI's "Today / Yesterday" labels use the same clock, so they cannot disagree. Dates are plain `YYYY-MM-DD` strings with UTC arithmetic: no DST or midnight drift. Month math clamps (Jan 31 + 1 month = Feb 28/29) and is tested across leap years and year boundaries.
- **Fair comparisons.** "This month so far" is compared with the _same number of days_ at the start of last month, never with a full month.
- **Definitions.** _Spent_ = expenses minus refunds. _Saved_ = income minus spent. _Savings rate_ = saved / income (absent when there is no income). Transfers are excluded everywhere. Only transactions in the user's main currency are counted; other currencies are reported as excluded, never converted.
- **Insights are rules with thresholds, not text templates over guesses.** Each rule has a minimum amount (20 major units) and a minimum percentage change, needs enough days of the month behind it, and stays silent otherwise (so an empty list is a valid answer). The projection is explicit about its assumption ("if the rest of the month looks like last month").
- **Chart bucketing** is chosen for readability: daily up to 14 days, weekly up to ~3 months, monthly beyond. Daily bars over a month were tried first and rejected: a single payday flattened the other 28 days.
- **Charts are accessible by construction.** Each has a text summary as its accessible name, a visually hidden data table with the same numbers, signed text (never colour alone), and theme-token colours so dark mode works.

## Budgets (implemented in Phase 6)

- **Calendar periods.** Weekly = Monday to Sunday, monthly = calendar month, yearly = calendar year. A budget applies from the period containing its start date until its optional end date. This makes "this month's food budget" mean what people expect and lets a week span two months without special cases.
- **What counts.** Net spending (expenses minus refunds) in the budget's category _and its subcategories_ (a budget on Coffee counts only Coffee), in the budget's currency, from the start of the period up to **today** (future-dated items count once their day arrives, matching the dashboard). Transfers and income never count. Budgets on a parent and a child overlap by design.
- **Pace and projection are deliberately conservative.** A projection ("you may exceed this budget by $72") is made only with at least 3 purchases and 25% of the period elapsed, and only warns when the overshoot is at least 3% of the limit. Without that evidence rule, a single rent payment on the 1st would extrapolate to 31x the limit. Rules live in `@pfm/finance/budgets` and are tested against these cases.
- **States are explained in words**, never colour alone: `ok`, `warning` (reached the alert percentage), `at_risk` (under the alert but pacing past the limit), `over`. The server returns the headline and detail text; the web renders it.
- **Guard rails.** Only active expense categories; one live budget per category and period (a finished one does not block a new one); a category with a budget cannot be deleted (archive it, or remove the budget first); the category of a budget cannot be changed (delete and recreate).

## Savings goals (implemented in Phase 7)

- **A goal is its own small ledger.** `currentAmount` is the sum of signed contributions (deposits positive, withdrawals negative), updated with an atomic increment in the same database transaction that records the contribution. `POST /api/goals/reconcile` proves the totals match (and a test corrupts a total on purpose to show the check really catches it). A goal does **not** move money between accounts; it records what you have set aside.
- **Guard rails.** You cannot take out more than is saved; you cannot date a contribution in the future (in the user's timezone); an archived goal accepts nothing until restored; removing a deposit that later withdrawals depend on is refused (it would leave a negative balance). A new or moved deadline must be today or later, but an old deadline is left alone when you edit other fields.
- **"$300/month to reach your goal by June".** Remaining amount divided by the number of whole months left (days left / 30.4375, rounded up, at least one), with the result rounded **up** so paying it really finishes the goal. Once the deadline has passed the goal is `overdue` and no monthly figure is shown.
- **Ahead / behind schedule.** Compared with a straight line from zero (on the day saving began: the earlier of creation and the first contribution) to the target on the deadline. Within 2% of the target counts as "on schedule". This is a deliberately simple, explainable plan, not a forecast.
- **Statuses** (`reached`, `overdue`, `no_deadline`, `ahead`, `on_track`, `behind`) are spelled out in words in the UI; behind/overdue add a "!" marker in addition to colour.

## Analytics screen (implemented in Phase 8)

Eight charts, each titled as the question it answers, share one filter bar kept in the URL (`range`, `from`, `to`, `account`, `category`, `type`).

| Question                                                        | Endpoint                            | Honours                                                               |
| --------------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------- |
| Am I earning more than I spend? / Am I saving or spending down? | `GET /analytics/cash-flow`          | range, account, category, type                                        |
| Where does it go?                                               | `GET /analytics/categories`         | range, account, category (spending only: `type` is ignored)           |
| How is my spending changing?                                    | `GET /analytics/spending-trend`     | range, account, category (spending only)                              |
| How does this month compare?                                    | `GET /analytics/monthly`            | account, category, type (always up to 12 months)                      |
| Is my net worth growing?                                        | `GET /analytics/balances`           | range, account (balances are not about categories or types)           |
| Am I building my savings?                                       | `GET /analytics/savings`            | range only                                                            |
| Do I keep to my budgets?                                        | `GET /analytics/budget-performance` | none (last six months of monthly budgets)                             |
| Summary strip                                                   | `GET /analytics/summary`            | range, account, category, type; compared with the equal period before |

- **Each chart says which filters it ignores**, in a footnote, instead of silently applying some and not others.
- **One source of truth.** Chart totals are asserted equal to the headline figures: spending-trend per period equals cash-flow expenses, the last balance point equals live account balances, the savings total equals the sum of goal totals.
- **Net worth over time** replays every transaction against opening balances (`balanceSeries`); transfers between own accounts never change the total; credit-card debt subtracts. Only main-currency accounts are plotted; others are named as excluded.
- **Honest comparisons.** The summary reports the date of the user's first transaction; when the "previous period" starts before it, the page says the comparison is only partly covered rather than printing a huge, misleading percentage. The month-by-month view skips months before any activity.
- **Every chart is accessible**: a written summary as its accessible name, a visually hidden data table with the same numbers, signed text rather than colour alone, theme-token colours for dark mode. The Analytics page is a lazy chunk, loaded only when opened.

## Recurring payments & subscriptions (implemented in Phase 9)

- **One schedule.** A `RecurringTransaction` is an income or expense rule: amount, account, category, frequency (daily/weekly/monthly/yearly) x interval, `nextOccurrence`, optional `endDate`. A _subscription_ is simply a recurring expense in the Subscriptions category; there is no second table to drift out of sync.
- **Pure schedule maths** lives in `@pfm/finance/recurring`: occurrences are computed from the anchor date (`anchor + k x interval` months), never by repeatedly adding a month, so a rule on the 31st returns to the 31st after February. Monthly/yearly cost normalises any cadence (weekly x 52 / 12, and so on) in integer minor units.
- **Turning rules into transactions** (`recurring.service.materialize`) goes through `TransactionsService.create`, so balances, validation and budgets follow the one write path. It runs (a) when the Recurring list or the dashboard overview is requested, (b) from a background job started in `server.ts` (at boot and every 10 minutes), and (c) via `POST /api/recurring/run`.
- **Safe to repeat.** A database unique constraint on `(recurringTransactionId, date)` means two processes racing can never record the same payment twice; the loser's unique violation is treated as "already done". Catch-up after downtime is capped at 60 payments per run.
- **No surprises.** A first payment must be today or later (nothing is invented from the past). Pausing and resuming skips what was missed. A rule past its `endDate` deactivates itself. A rule whose account or category was archived is _held_ (`blocked` is reported to the UI) instead of failing or being deleted; it continues when fixed. Deleting a rule keeps the transactions it already recorded.
- **Changes affect the future only.** Editing the schedule re-anchors on the date you choose; editing the amount never touches recorded payments.
- **Totals never mix currencies**: the list reports totals in the user's main currency and names any currencies left out. The dashboard "Coming up" list and (in Phase 10) the calendar read `GET /api/recurring/occurrences`, which expands active rules over a date range (max 400 days).
- The subscriptions insight ("Your subscriptions cost about $46.97 a month ($563.64 a year).") is shown to the cent, not rounded, because people compare it with real bills.

## Notifications, calendar, search, import and export (implemented in Phase 10)

- **Notifications are derived, not typed in.** `notifications.service.sync` looks at budgets (threshold reached, exceeded), recurring bills due within 3 days, and reached goals, and inserts what is new with `createMany({ skipDuplicates })`. Each condition has a `dedupeKey` that includes its period (`budget:<id>:<periodStart>:over`, `bill:<ruleId>:<date>`, `goal:<id>:reached`), so it fires once per period however often `sync` runs, and marking something read never brings it back. Sync runs when the list, the unread count or "mark all read" is requested (the header bell polls the count every minute).
- **Calendar** (`GET /api/calendar?from&to`, 62 days max) merges three things per day: what was recorded (with daily income/spent in the main currency, refunds reducing spending), payments still to come (never in the past: those are transactions), and goal deadlines. Only days with something are returned. The grid gives every day a full-sentence accessible name, and phones get compact marks while wider screens show amounts.
- **Search** (`GET /api/search?q`) passes the query through a `SearchInterpreter` (`@pfm/finance/search`). The shipped rule-based interpreter understands amounts ("over $50", "between 10 and 30", "$12.50"), dates ("last month", "yesterday", "in March"), type ("expenses", "income") and category names, and leaves everything else as text. The response includes what was understood, so the UI can say so and "see all" opens the Transactions screen with exactly that filter. A smarter interpreter can fill the same `InterpretedQuery` shape without touching the service or UI.
- **CSV export** streams all pages of the current filters, with exact decimal amounts, a UTF-8 BOM for spreadsheet apps, and **formula defusing** (cells starting with `= + - @` are prefixed with `'`), rate-limited and audit-logged.
- **CSV import** is two calls over the same analysis: `preview` (nothing changes) and `commit`. The file is read in the browser and sent as text (2 MB / 5,000 rows). Columns are guessed from headers (English, German, Spanish, Russian hints) and confirmed on screen; date order and decimal mark are explicit settings, never guessed from ambiguous data. Rows are validated with the same rules as manual entry (zero amounts, impossible dates, unmatched types are reported by line number). **Duplicates** are found by a per-row fingerprint (`importHash`) over user, account, date, signed amount, normalised description and the row's occurrence number, so two identical coffees in one file are both kept while re-importing the same file is a no-op. Imports go through `TransactionsService.create`, so balances and budgets stay consistent.

## Polish: performance, accessibility, motion, deployment (implemented in Phase 11)

- **Bundle.** Every signed-in screen is a lazy route, and vendor libraries are split into stable chunks (`react`,
  `router`, `query`, `ui-kit`, `forms`, `dates`, `charts`). The entry chunk went from 804 kB (247 kB gzip) to
  129 kB (40 kB gzip). The 419 kB charting chunk loads only when a screen draws a chart.
- **Accessibility is tested, not asserted.** `a11y.test.tsx` runs axe-core on all twelve signed-in screens, the
  three signed-out screens, and the add-recurring, import and command-menu dialogs. `contrast.test.ts` checks
  21 text/background token pairs against WCAG AA in both themes (it found, and fixed, an error-red that was
  4.45:1 on its tint). Heading order and landmark names came from the same audit.
- **Route changes.** Each screen sets its own `document.title`, and focus moves to the content on navigation so
  keyboard and screen-reader users start at the top of the new screen. Content fades in over 200 ms; all
  animation and transition durations collapse under `prefers-reduced-motion`.
- **Layout.** Overflow was measured on all twelve screens at 1440, 1280, 768 and 390 px. The one failure
  (Analytics at 390) was visually hidden text inside a horizontally scrolling table escaping its scroller;
  scroll wrappers are now `relative` so such text is clipped with the table.
- **Chart axes** use a tested helper (`niceDomain`): five ticks on 1 / 1.5 / 2 / 2.5 / 3 / 4 / 5 × 10ⁿ, so axes read
  $0 · $1.5K · $3K · $4.5K · $6K instead of $0 · $1.4K · $2.9K.
- **Deployment.** See [DEPLOYMENT.md](DEPLOYMENT.md): multi-stage images for the API (non-root, migrations on
  start, health check) and the web app (nginx with a strict CSP, immutable asset caching, `/api` proxy), and a
  production compose file.

## Testing (implemented in Phase 12)

Four layers (unit, API integration against real PostgreSQL, component, and Playwright end-to-end) are described
in [TESTING.md](TESTING.md), with how to run them, what each suite covers, and the defects the audit found.
The end-to-end suite boots its own database, API and web server on private ports, so it can run beside a
development environment, and checks things only a real browser can: colour contrast, focus behaviour, layout at
four widths, downloads, cookies and cross-user access.
