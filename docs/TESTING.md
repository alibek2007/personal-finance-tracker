# Testing

Four layers, each catching what the one below cannot.

| Layer                    | Tool                                | What it proves                                                                                                                                                                         | Command            |
| ------------------------ | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| **Unit** (pure logic)    | Vitest                              | Money, ledger, periods, budgets, goals, recurring schedules, insights, search and CSV parsing, chart axes: the rules, with no I/O                                                      | `npm test`         |
| **Integration** (API)    | Vitest + real PostgreSQL            | Every endpoint against a real database: validation, ledger integrity, tenant isolation, idempotency, race safety. Each test file gets its own database cloned from a migrated template | `npm test`         |
| **Component** (web)      | Vitest + Testing Library + axe-core | Screens, forms and dialogs against a mocked API: states (loading, empty, error), exact money in requests, structural accessibility on every screen                                     | `npm test`         |
| **End to end** (browser) | Playwright with the real stack      | The whole product in Chrome: real database, real API, real browser. Sign-up to export, security, accessibility with colour contrast, keyboard use, four screen widths                  | `npm run test:e2e` |

`npm test` runs the first three (about 715 tests, under a minute and a half). The E2E suite adds 148
tests and takes about 1.5 minutes.

## Running the end-to-end suite

```bash
npm run test:e2e                 # everything
npm run test:e2e -- keyboard     # files matching "keyboard"
npm run test:e2e -- --headed     # watch it drive the browser
npm run report -w @pfm/e2e       # open the last HTML report (traces for failures)
```

It starts its **own** stack on separate ports, so a running dev environment is never touched: PostgreSQL on
54331 (a throwaway embedded instance, migrated and seeded with the demo ledger), the API on 4100, the web
app on 5273. It uses the Chrome installed on your machine, so there is nothing to download; to use
Playwright's bundled Chromium instead, run `npx playwright install chromium` once and set
`E2E_BROWSER=chromium`.

### How tests stay independent

- **Read-only tests** share the seeded demo user ("Alex"), signed in once in global setup.
- **Anything that changes data** uses a fresh user created through the API for that one test (the `user` and
  `data` fixtures), so tests can run in parallel and in any order.
- Tests wait for the _save_ to finish (`clickAndSave`), never for time to pass.

### What the suites cover

| File            | Covers                                                                                                                                                          |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth`          | Sign-up, sign-out, return-to-where-you-were, wrong password, validation, duplicate email, HttpOnly session cookie                                               |
| `ledger`        | Accounts, expenses, exact cents, transfers keep net worth, edit and delete keep balances right, URL-synced filters, another user's data is invisible            |
| `budgets-goals` | Budget warnings and "over budget" notices (once each), goal contributions and "reached"                                                                         |
| `recurring`     | A payment due today becomes one real transaction (never two), subscription totals, pausing, coming-up list, bill notices, past dates refused                    |
| `discover`      | Natural-language search ("expenses over $50 last month"), calendar, notifications, page titles and focus on navigation                                          |
| `import-export` | Preview before import, bad rows by line, importing twice never doubles, column mapping, filtered export round-trips, spreadsheet-formula injection defused      |
| `security`      | CSRF marker and Origin checks, auth on every data route, cross-user access (reads, writes, deletes) all 404, signed-out cookies are dead, hostile text is inert |
| `a11y`          | axe-core (WCAG 2.2 AA + best practice, **including colour contrast**) on all 12 screens × light/dark × desktop/phone, plus dialogs and menus                    |
| `keyboard`      | Skip link, visible focus on every Tab stop, focus trapping and restoring, command menu, forms, arrow keys, calendar                                             |
| `responsive`    | 12 screens × 1440/1280/768/390 px: no sideways scrolling, layout viewport not stretched, nothing off-screen; 24 px tap targets; screenshots saved for review    |
| `mobile`        | Phone-only behaviour: bottom bar instead of sidebar, More sheet, one-handed add, bottom-sheet dialogs, compact calendar                                         |

Screenshots from the responsive run land in `e2e/screenshots/<width>/` (git-ignored). They are for people to
look at; pixel-diff baselines are deliberately not used, because fonts and anti-aliasing differ per machine
and would make the suite flaky.

## What the Phase 12 audit found and fixed

Real-browser testing found things the component tests could not:

| Found by          | Problem                                                                                              | Fix                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| axe (real layout) | Budgets and Goals put a progress bar directly inside a `<dl>` (invalid structure)                    | Layout wrapper outside the definition list                                |
| axe               | Donut chart's clickable legend sat inside `role="img"` (nested interactive controls)                 | `ChartCard interactive`; the graphic alone is the image                   |
| axe               | Chart libraries added their own tab stop inside chart images                                         | `accessibilityLayer` off; every chart has a text summary and a data table |
| axe               | Sideways-scrolling tables on phones could not be scrolled with a keyboard                            | Scroll regions are focusable, labelled regions                            |
| Keyboard suite    | Dialogs opened from a button did not return focus to it when closed                                  | `DialogContent`/`DrawerContent` restore focus to the opener               |
| Keyboard suite    | My own focus-on-navigate stole focus from a form's autofocused field, and ran twice under StrictMode | Only moves focus when nothing inside the page has it; compares by path    |
| Responsive        | The phone "Filters" toggle was 23 px tall (WCAG 2.2 minimum is 24)                                   | Minimum heights                                                           |
| Visual review     | Dashboard donut legend truncated names to "Ho…" and "En…" at 1440 px                                 | Legend stacks under the donut in the narrow column                        |
| Load              | Four browsers tripped the API's global rate limit (300 requests/min per IP)                          | Limit is now configurable (`RATE_LIMIT_MAX`); E2E raises it               |

## Conventions

- A bug fix starts with a failing test at the lowest layer that can show it.
- Money assertions use exact strings (`$957.50`), never rounded floats.
- Selectors are roles and labels, which doubles as a check that the screen is accessible.
- Anything user-visible that can fail (loading, empty, error) has a test for that state.
