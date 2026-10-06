/**
 * Deterministic demo data for "Alex": four months of believable personal finances.
 * Pure (no I/O): the same `today` and `seed` always give the same list, so it is testable.
 */
export type AccountKey = 'checking' | 'savings' | 'cash' | 'card';

export interface DemoAccount {
  key: AccountKey;
  name: string;
  type: 'bank' | 'savings' | 'cash' | 'credit_card';
  institution: string | null;
  initialBalance: number;
  color: string;
  icon: string;
}

export const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    key: 'checking',
    name: 'Checking',
    type: 'bank',
    institution: 'Northwind Bank',
    initialBalance: 300_000,
    color: '#1f4e5a',
    icon: 'landmark',
  },
  {
    key: 'savings',
    name: 'Savings',
    type: 'savings',
    institution: 'Northwind Bank',
    initialBalance: 700_000,
    color: '#2e6b4b',
    icon: 'piggy-bank',
  },
  {
    key: 'cash',
    name: 'Cash',
    type: 'cash',
    institution: null,
    initialBalance: 20_000,
    color: '#b98a2e',
    icon: 'banknote',
  },
  {
    key: 'card',
    name: 'Credit Card',
    type: 'credit_card',
    institution: 'Northwind Bank',
    initialBalance: 0,
    color: '#b2432b',
    icon: 'credit-card',
  },
];

export interface DemoTx {
  account: AccountKey;
  type: 'income' | 'expense' | 'transfer';
  amount: number;
  /** Category name from the default tree (omitted for transfers). */
  category?: string;
  description: string;
  merchant?: string;
  date: string;
  toAccount?: AccountKey;
  isRefund?: boolean;
}

/** Small, fast, seedable PRNG (mulberry32). */
export function createRng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!,
    chance: (p: number) => next() < p,
  };
}

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export function buildDemoTransactions(today: Date, seed = 42, monthsBack = 3): DemoTx[] {
  const rng = createRng(seed);
  const todayIso = iso(today.getUTCFullYear(), today.getUTCMonth() + 1, today.getUTCDate());
  const txs: DemoTx[] = [];
  const add = (tx: DemoTx) => {
    if (tx.date <= todayIso) txs.push(tx);
  };
  const cents = (dollars: number) => Math.round(dollars * 100);
  const roundTo = (value: number, step: number) => Math.round(value / step) * step;

  for (let offset = -monthsBack; offset <= 0; offset++) {
    const base = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + offset, 1));
    const y = base.getUTCFullYear();
    const m = base.getUTCMonth() + 1;
    const last = daysInMonth(y, m);
    const day = (d: number) => iso(y, m, Math.min(d, last));
    const randomDays = (count: number) =>
      Array.from({ length: count }, () => rng.int(1, last)).sort((a, b) => a - b);

    // ---- fixed monthly rhythm
    add({
      account: 'checking',
      type: 'income',
      amount: cents(4800),
      category: 'Salary',
      description: 'Salary',
      merchant: 'Acme Corp',
      date: day(1),
    });
    add({
      account: 'checking',
      type: 'expense',
      amount: cents(1850),
      category: 'Rent',
      description: 'Rent',
      merchant: 'Maple Street Apartments',
      date: day(1),
    });
    add({
      account: 'checking',
      type: 'transfer',
      amount: cents(500),
      description: 'Monthly savings',
      date: day(2),
      toAccount: 'savings',
    });
    add({
      account: 'checking',
      type: 'transfer',
      amount: cents(100),
      description: 'ATM withdrawal',
      date: day(10),
      toAccount: 'cash',
    });
    add({
      account: 'checking',
      type: 'expense',
      amount: roundTo(cents(rng.int(105, 148)), 1),
      category: 'Utilities',
      description: 'Electric & water',
      merchant: 'City Utilities',
      date: day(5),
    });
    add({
      account: 'savings',
      type: 'income',
      amount: cents(rng.int(11, 14)) + rng.int(0, 99),
      category: 'Interest',
      description: 'Savings interest',
      merchant: 'Northwind Bank',
      date: day(28),
    });
    if (offset % 2 === 0) {
      add({
        account: 'checking',
        type: 'income',
        amount: cents(450),
        category: 'Freelance',
        description: 'Logo design for Fern & Co',
        merchant: 'Fern & Co',
        date: day(15),
      });
    }

    // ---- subscriptions (about $47/month)
    add({
      account: 'card',
      type: 'expense',
      amount: 999,
      category: 'Subscriptions',
      description: 'iCloud+',
      merchant: 'Apple',
      date: day(3),
    });
    add({
      account: 'card',
      type: 'expense',
      amount: 900,
      category: 'Subscriptions',
      description: 'Dropbox',
      merchant: 'Dropbox',
      date: day(8),
    });
    add({
      account: 'card',
      type: 'expense',
      amount: 1599,
      category: 'Subscriptions',
      description: 'Netflix',
      merchant: 'Netflix',
      date: day(12),
    });
    add({
      account: 'card',
      type: 'expense',
      amount: 1199,
      category: 'Subscriptions',
      description: 'Spotify',
      merchant: 'Spotify',
      date: day(18),
    });

    // ---- variable spending
    for (let d = rng.int(2, 6); d <= last; d += rng.int(5, 8)) {
      add({
        account: rng.chance(0.6) ? 'card' : 'checking',
        type: 'expense',
        amount: cents(rng.int(52, 118)) + rng.int(0, 99),
        category: 'Groceries',
        description: 'Groceries',
        merchant: rng.pick(['Whole Foods', "Trader Joe's", 'Safeway']),
        date: day(d),
      });
    }
    for (const d of randomDays(rng.int(3, 4))) {
      add({
        account: rng.chance(0.65) ? 'card' : 'checking',
        type: 'expense',
        amount: cents(rng.int(24, 68)) + rng.int(0, 99),
        category: 'Restaurants',
        description: rng.pick(['Dinner out', 'Lunch with friends', 'Brunch', 'Takeout']),
        merchant: rng.pick(['Osteria Luna', 'Ramen Ya', 'The Corner Bistro', 'Taqueria Sol']),
        date: day(d),
      });
    }
    for (const d of randomDays(rng.int(8, 11))) {
      add({
        account: rng.chance(0.6) ? 'cash' : 'card',
        type: 'expense',
        amount: cents(rng.int(3, 6)) + rng.pick([0, 50, 75]),
        category: 'Coffee',
        description: rng.pick(['Latte', 'Flat white', 'Cappuccino']),
        merchant: rng.pick(['Blue Bottle', 'Local Roasters', 'Starbucks']),
        date: day(d),
      });
    }
    for (const d of randomDays(rng.int(2, 4))) {
      add({
        account: 'card',
        type: 'expense',
        amount: cents(rng.int(11, 26)) + rng.int(0, 99),
        category: 'Taxi',
        description: 'Ride home',
        merchant: 'Uber',
        date: day(d),
      });
    }
    for (const d of randomDays(rng.int(1, 2))) {
      add({
        account: 'card',
        type: 'expense',
        amount: cents(rng.int(38, 165)) + rng.int(0, 99),
        category: 'Shopping',
        description: rng.pick(['New jacket', 'Home goods', 'Books', 'Headphones case']),
        merchant: rng.pick(['Amazon', 'Zara', 'IKEA', 'Uniqlo']),
        date: day(d),
      });
    }
    if (rng.chance(0.4)) {
      add({
        account: 'checking',
        type: 'expense',
        amount: cents(rng.int(22, 74)),
        category: 'Health',
        description: 'Pharmacy',
        merchant: 'CVS',
        date: day(rng.int(1, last)),
      });
    }
    if (rng.chance(0.5)) {
      add({
        account: 'card',
        type: 'expense',
        amount: cents(rng.int(14, 32)),
        category: 'Movies',
        description: 'Cinema tickets',
        merchant: 'AMC',
        date: day(rng.int(1, last)),
      });
    }
    if (rng.chance(0.4)) {
      add({
        account: 'cash',
        type: 'expense',
        amount: cents(rng.int(18, 36)),
        category: 'Groceries',
        description: 'Farmers market',
        merchant: 'Saturday Market',
        date: day(rng.int(1, last)),
      });
    }
  }

  // One refund on the card: the return of an earlier purchase.
  const purchase = txs.find((t) => t.account === 'card' && t.category === 'Shopping');
  if (purchase) {
    const refundDay = new Date(Date.parse(`${purchase.date}T00:00:00Z`) + 6 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    add({
      account: 'card',
      type: 'income',
      amount: purchase.amount,
      category: 'Shopping',
      description: `Return: ${purchase.description}`,
      merchant: purchase.merchant ?? 'Store',
      date: refundDay,
      isRefund: true,
    });
  }

  txs.sort((a, b) => a.date.localeCompare(b.date));

  // Pay the card off on the 25th of each month with whatever was owed on the day before.
  const payments: DemoTx[] = [];
  const months = new Set(txs.map((t) => t.date.slice(0, 7)));
  for (const month of [...months].sort()) {
    const payDate = `${month}-25`;
    if (payDate > todayIso) continue;
    const outstanding = txs
      .filter((t) => t.account === 'card' && t.date < payDate)
      .reduce((sum, t) => sum + (t.type === 'expense' ? t.amount : -t.amount), 0);
    const alreadyPaid = payments.reduce((sum, p) => sum + p.amount, 0);
    const due = outstanding - alreadyPaid;
    if (due > 0) {
      payments.push({
        account: 'checking',
        type: 'transfer',
        amount: due,
        description: 'Credit card payment',
        date: payDate,
        toAccount: 'card',
      });
    }
  }
  return [...txs, ...payments].sort((a, b) => a.date.localeCompare(b.date));
}
