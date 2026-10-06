# Roadmap

Status legend: ☐ todo · ◐ in progress · ☑ done

| Phase | Scope                                                                                                                 | Status |
| ----- | --------------------------------------------------------------------------------------------------------------------- | ------ |
| 0     | Repo inspection, architecture / DB / design docs                                                                      | ☑      |
| 1     | Monorepo, API + web skeleton, Prisma schema, env config, lint/format/test, money utility, session/password foundation | ☑      |
| 2     | Design system: tokens, fonts, `packages/ui`, app shell, responsive nav, dark mode                                     | ☑      |
| 3     | Auth: register/login/logout/me, protected routes, CSRF, rate limits, verify/reset architecture                        | ☑      |
| 4     | Core finance: accounts, categories, transactions, transfers, balance integrity                                        | ☑      |
| 5     | Dashboard (overview endpoint, cash flow, breakdown, insights, recent)                                                 | ☑      |
| 6     | Budgets                                                                                                               | ☑      |
| 7     | Savings goals                                                                                                         | ☑      |
| 8     | Analytics                                                                                                             | ☑      |
| 9     | Recurring payments & subscriptions                                                                                    | ☑      |
| 10    | Notifications, calendar, global search, CSV export/import                                                             | ☑      |
| 11    | Polish: responsive, a11y audit, motion, performance, EXPLAIN review                                                   | ☑      |
| 12    | Unit, integration, E2E (Playwright), visual QA at 1440/1280/768/390                                                   | ☑      |

## Cross-cutting definition of done (every phase)

`npm run typecheck && npm run lint && npm test` green; feature verified in a real browser; empty/loading/error states present; no hardcoded financial numbers; every query user-scoped.

## Risks & edge cases register

| Risk                           | Mitigation                                                                                                       |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| No local PostgreSQL/Docker     | `embedded-postgres` dev script; compose file; DATABASE_URL-agnostic                                              |
| Balance cache drift            | Single in-transaction write path; reconcile service + tests                                                      |
| Float errors                   | Integer minor units; BigInt rational math; lint ban on `Number` arithmetic in finance package via review + tests |
| Timezone / month boundaries    | DATE columns; period helpers take tz + injected "now"; tests for Dec→Jan, Feb 29, DST days                       |
| Monthly recurrence on 29–31    | Clamp to last day of month but remember original anchor day (Jan 31 → Feb 28 → Mar 31)                           |
| Multi-currency                 | Per-currency aggregation, explicit notice; FX table is future work, never silently summed                        |
| Credit card sign confusion     | Negative balance = debt, net worth subtracts it; dedicated tests                                                 |
| Refunds                        | `isRefund` income nets against category spend, not counted as income in savings rate                             |
| Edited/deleted transactions    | Reverse-then-apply in one DB tx; tests for balance after edits                                                   |
| Budget crossing month boundary | Budget period windows computed from `startDate`+period, not calendar month only                                  |
| Cross-tenant leakage           | userId first param in all repos; integration tests with two users per resource                                   |
| CSRF with cookie sessions      | SameSite=Lax + custom header + Origin check                                                                      |
| CSV import abuse               | Size/row limits, formula-injection escaping on export, preview before commit                                     |
| Notification spam              | `dedupeKey` once per condition per period                                                                        |
| Fake insights                  | Insights are pure functions of data with minimum-data thresholds; return nothing rather than guess               |

## Phase 4 follow-ups (known gaps, tracked)

| Item                                                          | Why it is not in Phase 4                                                                                        | Planned             |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------- |
| Category management screen (add / rename / archive in the UI) | API is complete and tested (`/api/categories`); only the screen is missing. Default tree is created at sign-up. | Start of Phase 5    |
| Account balance history chart                                 | Data endpoint exists (`/api/accounts/:id/balance-history`); charts are built once in Phase 8                    | Phase 8             |
| CSV export / import                                           | Phase 10 scope (done in Phase 10)                                                                               | ☑ Phase 10          |
| Date picker component                                         | Native `<input type="date">` is used (accessible, best on mobile)                                               | Revisit in Phase 11 |

## Phase 5 follow-ups (known gaps, tracked)

| Item                                                                 | Why it is not in Phase 5                                                                                                                               | Planned        |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- |
| Budget progress and savings goals sections on the dashboard          | Budgets and goals do not exist yet; showing empty placeholders would be dishonest                                                                      | Phases 6 and 7 |
| "Your subscriptions cost $47/month" insight                          | Needs real recurring payments, not a guess from category names (done in Phase 9)                                                                       | ☑ Phase 9      |
| Budget alerts in insights                                            | Needs budgets                                                                                                                                          | Phase 6        |
| Cash-flow and breakdown aggregation in SQL                           | Computed in application code from lean rows (one query per request). Fine at personal scale; `EXPLAIN` review in Phase 11 decides whether to push down | Phase 11       |
| Net-worth-over-time chart                                            | Account balance history data exists; chart belongs with Analytics                                                                                      | Phase 8        |
| Main bundle size (729 kB, 228 kB gzipped after splitting charts out) | Needs a bundle analysis to find the real contributors before cutting anything                                                                          | Phase 11       |

## Phase 6 follow-ups (known gaps, tracked)

| Item                                                        | Why it is not in Phase 6                                                                                                                                | Planned     |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| Budget alert notifications ("Your Food budget is 82% used") | The status is computed and flagged in the UI; delivering it as a notification (once per period) belongs with the notification system (done in Phase 10) | ☑ Phase 10  |
| Budget history chart                                        | `GET /api/budgets/:id` already returns six periods of history; the chart belongs with Analytics ("Budget performance")                                  | Phase 8     |
| Rollover of unspent budget                                  | Deliberately out of scope: adds hidden state that makes "how much is left" harder to trust                                                              | Not planned |

## Phase 7 follow-ups (known gaps, tracked)

| Item                                                  | Why it is not in Phase 7                                                                                                                                                         | Planned                |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| "Your savings goal is ahead of schedule" notification | Status is computed and shown; delivering it once per change belongs with the notification system                                                                                 | Phase 10               |
| Linking a contribution to an account transfer         | Goals are deliberately a separate ledger of _intentions_: a contribution does not move money between accounts. Linking would couple two systems and make edits/deletes ambiguous | Revisit after real use |
| Goals progress chart over time                        | History data exists (`GET /api/goals/:id`); chart belongs with Analytics ("Savings progress")                                                                                    | Phase 8                |

## Phase 8 follow-ups (known gaps, tracked)

| Item                                                                  | Why it is not in Phase 8                                                                                                       | Planned              |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------- |
| Chart axis ticks are automatic (can land on values like $950 / $1.9K) | Cosmetic; a "nice ticks" helper is a small, separate polish item (done in Phase 11)                                            | ☑ Phase 11           |
| Budget performance uses each budget's _current_ limit                 | Limit changes are not versioned; noted on the chart                                                                            | Revisit if users ask |
| Export of an analytics view (CSV / image)                             | CSV export is Phase 10; image export is not planned                                                                            | Phase 10 (CSV)       |
| Aggregation is done in application code from lean rows                | Fine at personal scale (one query per chart); `EXPLAIN` review decides whether to push down (reviewed in Phase 11: not needed) | ☑ Phase 11           |

## Phase 9 follow-ups (known gaps, tracked)

| Item                                                           | Why it is not in Phase 9                                                                                                       | Planned              |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------- |
| Recurring transfers (e.g. monthly savings transfer)            | Income and expense only; a transfer rule needs a second account and currency handling                                          | Revisit if users ask |
| Back-dated rules ("started in March")                          | A first payment must be today or later, so nothing is invented; backfilling would need an explicit "record past payments" step | Revisit if users ask |
| "Bill due" notifications for upcoming payments                 | The data exists (`/recurring/occurrences`); the notification centre arrives in Phase 10 (done)                                 | ☑ Phase 10           |
| Upcoming payments on the calendar                              | Same endpoint, drawn on the calendar in Phase 10 (done)                                                                        | ☑ Phase 10           |
| Cancel-by reminders / price-change detection for subscriptions | Needs notifications first; price changes are visible today by editing the amount                                               | Phase 10+            |
| Job runs inside the API process                                | Fine for one instance (idempotent, so several are safe too); a separate worker or scheduler is a deployment decision           | Phase 11             |

## Phase 10 follow-ups (known gaps, tracked)

| Item                                                                  | Why it is not in Phase 10                                                                                                                     | Planned              |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| "Goal ahead of schedule" notification                                 | Only "goal reached" is announced: "ahead" flips as money moves, so a fair once-per-change rule needs design                                   | Revisit if users ask |
| Notifications are created when someone looks, not by the job          | The bell polls every minute, so an open app is current; a closed app learns on the next visit. Push/email delivery needs a provider           | Phase 11 / post-v1   |
| Notification preferences (mute a type, change the 3-day bill lead)    | Defaults are sensible; the data model supports adding preferences later                                                                       | Revisit if users ask |
| Language-model search                                                 | The `SearchInterpreter` seam is in place; the shipped interpreter is rule-based (amounts, dates, type, category) and shows what it understood | Post-v1              |
| Search by account or merchant filters in the sentence                 | "in Checking" is not parsed yet; use the account filter on Transactions                                                                       | Revisit if users ask |
| Import: transfers, multi-currency rows, categories created on the fly | Imports are income/expense into one account; unmatched categories import uncategorised (and are listed) instead of being invented             | Revisit if users ask |
| Import is not one database transaction                                | Rows are written one by one through the ledger service; every row has a fingerprint, so re-running the same file finishes the job safely      | Phase 11 (review)    |
| Export of accounts, budgets, goals                                    | Transactions are the data people ask for; the others are small and can be added the same way                                                  | Revisit if users ask |

## Phase 11 follow-ups (known gaps, tracked)

| Item                                                           | Why it is not in Phase 11                                                                                                                           | Planned             |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Docker images are unbuilt in the dev environment               | No Docker was available; the files are reviewed and the checkable parts verified (see docs/DEPLOYMENT.md). First build on a Docker host is the test | Before first deploy |
| Colour contrast on the _rendered_ pages is not machine-checked | jsdom has no layout. Every token pair is tested for WCAG AA (both themes); real-browser contrast checks need the E2E suite                          | ☑ Phase 12          |
| Screen-reader and keyboard walk-through by a person            | axe-core covers structure on every screen and key dialog; it cannot judge whether the experience makes sense                                        | Phase 12            |
| Text search is `ILIKE '%…%'`                                   | Sub-millisecond when matches are common, up to a full scan of one user's rows when rare (~50 ms at 200k rows). `pg_trgm` is the upgrade if needed   | If it ever shows up |
| Counts and balance sums scan a user's rows                     | ~50-70 ms at 200,000 transactions (more than a lifetime of personal data). Summary tables or cached counts are the upgrade                          | If it ever shows up |
| Rate limiting is in-process                                    | Fine for one instance; several replicas need a shared store or an edge limit                                                                        | With scale-out      |
| Background job runs inside the API process                     | Idempotent, so replicas are safe; a dedicated worker is a deployment preference                                                                     | With scale-out      |

## Phase 12 follow-ups and what remains open

| Item                                                 | Status                                                                                                                                         |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Docker images unbuilt                                | Still open: no Docker in the development environment. Build them once on a Docker host (see docs/DEPLOYMENT.md) before the first deploy        |
| Cross-browser coverage                               | E2E runs in Chrome only. Firefox and Safari/WebKit projects are one config entry each in `e2e/playwright.config.ts` when needed                |
| A person using a screen reader                       | Automated checks cover structure, names, contrast and keyboard behaviour; a manual pass with NVDA/VoiceOver is still worth doing before launch |
| Real-device phone testing                            | Phone behaviour is tested at 390 px with touch emulation, not on hardware                                                                      |
| Load testing                                         | Query plans were reviewed at 200,000 rows (Phase 11); concurrent-user load has not been tested                                                 |
| Notification delivery by email or push               | Out of scope for v1 (in-app only)                                                                                                              |
| Dashboard for a user who only has scheduled payments | The empty state shows until the first transaction, so "Coming up" is hidden until then. Honest, but a small gap                                |
