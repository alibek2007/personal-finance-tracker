# Design System — "Editorial Financial Intelligence"

## Target user

Salaried or freelance adult (22–45) tracking money in a few accounts, on phone for quick entry and laptop for review. Anxious about overspending, not an accountant. Wants _answers_, not a spreadsheet.

## Personality

Calm, precise, quietly confident. Think a well-set financial newspaper page or a Swiss bank statement — not a neon crypto app. Hierarchy comes from type scale, whitespace and hairlines, not from boxes.

## Self-critique of the first idea (and what changed)

| First instinct                                 | Why it fails                 | Decision                                                                                                             |
| ---------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| White bg, 4 equal KPI cards, blue/green accent | Generic AI finance dashboard | One dominant figure (net balance) set large in serif; Income / Spent / Saved as a ruled row of three, no card chrome |
| Rounded 16px cards with shadows everywhere     | Visual noise                 | Hairline rules + selective tinted panels; radius 6px max, shadows only on floating layers                            |
| Green primary                                  | Reads as "every fintech"     | Accent is deep **petrol** ink; green/red reserved purely for gains/losses                                            |
| Color-only +/−                                 | Inaccessible                 | Always sign (+/−) and arrow glyph in addition to color                                                               |

## Color tokens (light → dark)

Semantic tokens only; components never use raw hex.

| Token            | Light            | Dark      | Use                                   |
| ---------------- | ---------------- | --------- | ------------------------------------- |
| `--bg`           | `#F6F3EC` paper  | `#14161A` | page                                  |
| `--surface`      | `#FBF9F4`        | `#1B1E23` | raised panels                         |
| `--surface-sunk` | `#EEEAE0`        | `#101215` | inputs, wells                         |
| `--rule`         | `#DAD5C8`        | `#2A2E35` | hairlines                             |
| `--ink`          | `#1C1E21`        | `#ECE9E1` | primary text                          |
| `--ink-muted`    | `#5B6169`        | `#9AA0A8` | secondary text (≥4.5:1)               |
| `--accent`       | `#1F4E5A` petrol | `#6FB3C2` | primary action, focus ring, selection |
| `--accent-ink`   | `#FFFFFF`        | `#0E1A1E` | text on accent                        |
| `--gain`         | `#2E6B4B`        | `#6DBE93` | income, positive delta                |
| `--loss`         | `#B2432B`        | `#E8826B` | expense, negative delta               |
| `--warn`         | `#A8741A`        | `#D9A441` | budget threshold                      |

Chart categorical palette (8, ordered by luminance-separated hue; validated for colour-blind distinction, always paired with labels/patterns): petrol `#1F4E5A`, ochre `#B98A2E`, clay `#B2432B`, sage `#6F8F72`, slate `#5B6B84`, plum-grey `#85687A`, sand `#B9AE94`, ink `#3A3F46`. Dark mode lifts each by ~25% lightness.

## Typography

- **Display / big figures: Newsreader** (serif, optical sizing) — greeting, net balance, page titles. Gives the editorial voice.
- **UI & body: Hanken Grotesk** — neutral, slightly humanist, excellent at small sizes.
- **Numerals:** all money uses `font-variant-numeric: tabular-nums lining-nums`; right-aligned in tables. Minus sign is a true `−`.
- Scale (rem): 0.75 / 0.8125 / 0.9375 / 1.0625 / 1.375 / 1.75 / 2.5 / 3.5. Labels are sentence case; no ALL-CAPS label spam (small-caps only for the single section eyebrow style).
- Self-hosted via `@fontsource-variable` (no third-party font requests; privacy).

## Spacing, radius, elevation, motion

- 4px base grid: 4, 8, 12, 16, 24, 32, 48, 64.
- Radius: `--r-sm 4px`, `--r-md 6px`, `--r-lg 10px` (dialogs/sheets only), pills for badges.
- Shadow: none on flat content; `--shadow-float` on popovers, dialogs, mobile FAB.
- Motion: 120 ms (micro), 200 ms (panels), 400 ms (chart entrance, number tween); ease-out. Everything gated by `prefers-reduced-motion`.
- Breakpoints: `sm 640`, `md 768`, `lg 1024`, `xl 1280`, `2xl 1536`.

## Chart language

- Recharts, no gridlines except a light horizontal baseline set; direct labels where possible, legends otherwise.
- Income = `--gain` solid, Expenses = `--loss` solid, net = `--ink` line. Category charts use the categorical palette, with the category's label and percentage always adjacent.
- Every chart has: title answering a question ("Where did my money go?"), `role="img"` + `aria-label` summary, an accessible data-table fallback (visually hidden), keyboard-focusable tooltips, empty and loading states.

## Navigation

- **Desktop (≥1024):** left sidebar, 232px: Dashboard, Transactions, Accounts, Budgets, Goals, Analytics, Recurring, Calendar; footer: Notifications, Settings, profile menu. Top bar: global search (`/` or `⌘K`), primary "Add transaction" button (`N`).
- **Tablet:** collapsed icon rail.
- **Mobile (<768):** bottom bar — Home · Transactions · **Add (raised, accent)** · Analytics · More. "More" sheet lists the rest. Forms open as bottom sheets.

## Dashboard wireframe (desktop 1440)

```
┌──────────┬───────────────────────────────────────────────────────────────┐
│ Sidebar  │  Search ⌘K                                   [+ Add transaction]│
│          │                                                                 │
│          │  Good morning, Alex                           October 2026 ▾    │
│          │  $12,450.00            (Newsreader 56px)                        │
│          │  Total balance · +$320 vs last month                            │
│          │  ───────────────────────────────────────────────────────────    │
│          │  Income        Spent        Saved        Savings rate          │
│          │  +$4,800       −$2,930      +$1,870      39%                   │
│          │  ───────────────────────────────────────────────────────────    │
│          │  Cash flow  [7D 30D 3M 6M 1Y]        │ Where it went           │
│          │  ▇ ▆ income vs expenses chart         │ donut + ranked list     │
│          │                                       │ (click → filtered txns) │
│          │  ───────────────────────────────────────────────────────────    │
│          │  Budgets (progress bars + pace)       │ Insights (3–4 sentences)│
│          │  Goals (thin progress)                │ Recent transactions     │
└──────────┴───────────────────────────────────────────────────────────────┘
```

Mobile: greeting + big balance, horizontal-scroll snapshot row, cash flow chart (full-bleed), breakdown, budgets, recent — single column, thumb-reachable Add.

## Components (build once, in `packages/ui`)

Button, IconButton, Input, MoneyInput, Select, Combobox, DatePicker, Dialog, Drawer/Sheet, DropdownMenu, Tooltip, Badge, Avatar, Card (used sparingly), ChartCard, Stat, Amount (signed, tabular, glyph), TransactionRow, TransactionList, AccountCard, BudgetProgress, GoalProgress, EmptyState, Skeleton, Toast, CommandMenu, DataTable. Built on Radix primitives + shadcn conventions, styled by the tokens above.

## Accessibility baseline

WCAG 2.2 AA contrast for all text tokens, visible 2px accent focus ring with 2px offset, semantic landmarks, skip link, all interactions keyboard-reachable, status never by color alone, reduced-motion respected, 44px touch targets on mobile.

## Implementation notes (Phase 2)

- Tokens live in `packages/ui/src/styles/tokens.css`; Tailwind utilities (`bg-surface`, `text-muted`, `border-rule`, `text-gain`…) are mapped from them in `styles/index.css`. A living reference is at `/design` (dev builds only).
- Built and tested: Button, IconButton, Input, Textarea, Select (native on purpose: best mobile UX), Field (label/hint/error wiring), MoneyInput (exact minor-unit parsing), Amount, Stat, Badge, Avatar, Card, Skeleton, EmptyState, ChartCard, ProgressBar, BudgetProgress, GoalProgress, SegmentedControl, Dialog (centered on desktop, bottom sheet on phones), Drawer, DropdownMenu, Tooltip, Toaster, CommandMenu, ThemeProvider.
- **Deferred until a feature gives them real data**: DatePicker, DataTable, TransactionRow/List, AccountCard (Phase 4), charts (Phases 5/8). Building them now would mean designing against invented data.
- Contrast note: `--warn` is used for bars only; warning _text_ uses `--warn-text` to stay above 4.5:1.
- Visual QA done at 1440, 768 and 390 in light and dark. Findings fixed: skeleton shimmer was a heavy blob in dark mode; stat trio crowded at 768.

## Accessibility checks (Phase 11)

- Text colour pairs are verified in `packages/ui/src/styles/contrast.test.ts` (WCAG AA, 4.5:1) for both themes.
  Add a pair there when you introduce a new text-on-surface combination.
- Structure is verified on every screen by `apps/web/src/a11y.test.tsx` (axe-core). New screens and dialogs
  should be added to that list.
- Page headings never skip a level: pages use one `h1`, sections `h2`, cards inside sections `h3`.
  `EmptyState` takes a `level` for this. A list row's name is plain text, not a heading.
- Two landmarks of the same kind need different names (the sidebar is "Main", the phone bar "Main, mobile").
- Anything that scrolls horizontally must be `relative`, or visually hidden text inside it can widen the page.
