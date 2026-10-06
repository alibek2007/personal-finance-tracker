import { formatMoney, money } from '@pfm/finance';
import { createDb } from '../src/lib/db';
import { DEMO_EMAIL, DEMO_PASSWORD, seedDemo } from '../src/modules/seed/seed-demo';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed demo data into a production environment.');
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env first.');
  process.exit(1);
}

const db = createDb(url);
try {
  const result = await seedDemo(db);
  console.log(
    `Seeded demo user with ${result.transactions} transactions, ${result.recurring} recurring payments and ${result.budgets} budgets and ${result.goals} goals.`,
  );
  for (const a of result.accounts) {
    console.log(`  ${a.name.padEnd(12)} ${formatMoney(money(a.balance, 'USD')).padStart(14)}`);
  }
  console.log(`\nSign in with  ${DEMO_EMAIL}  /  ${DEMO_PASSWORD}   (demo data only)`);
} finally {
  await db.$disconnect();
}
