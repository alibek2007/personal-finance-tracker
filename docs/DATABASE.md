# Database

Source of truth: [`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma). PostgreSQL + Prisma 6.

## Conventions

- **Money** = `BIGINT` integer minor units + a `currency` code (ISO 4217, 3 chars). `BigInt` in Prisma, converted at the repository boundary to JS `number` (guarded with `Number.isSafeInteger`; ±9×10¹⁵ minor units ≈ $90 trillion).
- **Transaction.amount is always positive**; direction derives from `type`. Avoids sign bugs when editing a transaction's type.
- **Dates**: `Transaction.date`, budget and goal dates are `DATE` (calendar day in the user's timezone). `createdAt/updatedAt` are `timestamptz`. Reports group by calendar day, so there is no timezone drift at month boundaries.
- **Tenancy**: every table has `userId` (directly, or via a parent for `GoalContribution` which also stores it). Every repository query includes it.
- **IDs**: `cuid` strings (non-enumerable, sortable-ish).

## Entities (summary)

| Model                          | Notes                                                                                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| User                           | `currency`, `timezone`, `locale` drive formatting and period boundaries                                                                   |
| Session / AuthToken            | Hashed tokens only; sessions revocable; auth tokens single-use (`consumedAt`)                                                             |
| Account                        | `currentBalance` is a cache kept in sync in-transaction; `@@unique(userId,name)`; archived accounts keep history                          |
| Category                       | Self-referencing tree (`parentId`), income/expense typed, archivable instead of deleted                                                   |
| Transaction                    | Single row per transfer (`accountId` → `transferAccountId`, `transferAmount` for FX); `isRefund`; `importHash` for dedupe                 |
| Budget                         | Per category and period; `alertThreshold` percent. Budget spent is _derived_ from transactions (including child categories), never stored |
| SavingsGoal / GoalContribution | `currentAmount` = Σ contributions (kept in sync transactionally); optional deadline                                                       |
| RecurringTransaction           | Schedule + template; `nextOccurrence` advanced by a idempotent materialiser job                                                           |
| Notification                   | `dedupeKey` unique per user ⇒ a condition notifies once per period (anti-spam)                                                            |
| AuditLog                       | Sensitive actions; `metadata` never contains secrets                                                                                      |

Deviations from the brief (deliberate): added `Session`, `AuthToken`, `AuditLog`, `GoalContribution`; there is no `Subscription` table: a subscription is a recurring expense in the "Subscriptions" category (one schedule, nothing to drift apart; migration `recurring_cleanup` dropped the early placeholder); `Budget.alertThreshold` is an integer percent; `User.emailVerifiedAt`.

## Indexes

| Index                                                                       | Serves                                      |
| --------------------------------------------------------------------------- | ------------------------------------------- |
| `Transaction(userId, date DESC)`                                            | list/paginate, dashboard windows, cash flow |
| `Transaction(userId, accountId, date DESC)`                                 | account history & balance history           |
| `Transaction(userId, categoryId, date DESC)`                                | category spend, budgets                     |
| `Transaction(userId, type, date DESC)`                                      | income/expense filters                      |
| `Transaction(accountId)`, `(transferAccountId)`                             | FK + balance recompute                      |
| `Transaction(userId, importHash)`                                           | CSV duplicate detection                     |
| `Budget(userId)`, `(userId, categoryId)`; `SavingsGoal(userId, isArchived)` | list pages                                  |
| `RecurringTransaction(userId, isActive, nextOccurrence)`                    | due-job scan, calendar                      |
| `Notification(userId, isRead, createdAt DESC)`                              | inbox & unread badge                        |
| `Session(tokenHash)` unique, `(expiresAt)`                                  | auth lookup, expiry sweep                   |

Query analysis plan (Phase 11): `EXPLAIN (ANALYZE, BUFFERS)` on the 6 hot queries (dashboard overview, cash-flow grouped by day/month, category breakdown, transactions list with filters, account balance history, budget spent) against a 100k-row seeded dataset; record results here.

## Integrity rules enforced in services (tested)

1. Create/edit/delete of a transaction updates `currentBalance` of affected accounts in the same DB transaction (editing reverses old effect, applies new).
2. Transfer: source ≠ destination; same currency ⇒ `transferAmount = amount`; different currency ⇒ `transferAmount` required.
3. Category type must match transaction type (income/expense); transfers have no category.
4. Transaction currency must equal its account's currency.
5. Archiving an account/category never deletes history; archived items are hidden from pickers but included in historical reports.
6. Deleting a category with transactions requires reassignment or archive.

## Local setup

`npm run db:dev` starts an embedded PostgreSQL (no Docker needed) on port 54329, or use `docker compose up -d db`. Then `npm run db:migrate` and `npm run db:seed`.

## Query-plan review (Phase 11)

`npm run db:explain -w @pfm/api` loads a synthetic ledger (200,000 transactions by default, `ROWS=` to change)
for a throwaway user, runs `EXPLAIN (ANALYZE)` on the app's hot queries, and removes the data. Result at
200,000 rows (one user):

| Query                                     | Plan                                  | Time               |
| ----------------------------------------- | ------------------------------------- | ------------------ |
| Transactions list, newest 25              | index `(userId, date DESC)`           | 0.4 ms             |
| …filtered by account / by category        | `(userId, accountId                   | categoryId, date)` | < 0.2 ms |
| Dashboard month, calendar 6 weeks         | index `(userId, date)`                | 0.5-1.6 ms         |
| Analytics, a year of expenses (≈25k rows) | bitmap scan on `(userId, date)`       | 6 ms               |
| Import duplicate check, 500 fingerprints  | index `(userId, importHash)`          | 2.8 ms             |
| Count for pagination / per-account sums   | sequential scan (inherent)            | 50-70 ms           |
| Text search, common term                  | walks the date index, stops at 6 hits | 0.1 ms             |

Conclusion: **no index changes were needed**; every query that can use an index does. The two scans are
aggregates over a user's whole history, which is expected and acceptable at personal scale. The script exits
non-zero if an index-eligible query ever falls back to a sequential scan, so it can run in CI after schema
changes.
