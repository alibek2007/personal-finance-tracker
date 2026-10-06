/**
 * Query-plan review. Loads a large synthetic ledger for a throwaway user, then runs EXPLAIN (ANALYZE) on
 * the queries the app issues most, and prints the plan type and timing. Cleans up after itself.
 *
 *   npm run db:explain -w @pfm/api            (200,000 transactions by default)
 *   ROWS=1000000 npm run db:explain -w @pfm/api
 *
 * The point is to catch a missing index or an accidental sequential scan before a user's data grows.
 */
import { PrismaClient } from '@prisma/client';

const ROWS = Number(process.env.ROWS ?? 200_000);
const db = new PrismaClient();
const EMAIL = 'explain-review@example.invalid';

interface Plan {
  'QUERY PLAN': {
    Plan: PlanNode;
    'Execution Time': number;
    'Planning Time': number;
  }[];
}
interface PlanNode {
  'Node Type': string;
  'Index Name'?: string;
  'Relation Name'?: string;
  'Actual Rows': number;
  Plans?: PlanNode[];
}

function flatten(node: PlanNode): PlanNode[] {
  return [node, ...(node.Plans ?? []).flatMap(flatten)];
}

async function explain(label: string, sql: string, expect: 'index' | 'any' = 'index') {
  const rows = await db.$queryRawUnsafe<Plan[]>(`EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`);
  const plan = rows[0]!['QUERY PLAN'][0]!;
  const nodes = flatten(plan.Plan);
  const scans = nodes.filter((n) => /Scan/.test(n['Node Type']));
  const seq = scans.filter(
    (n) => n['Node Type'] === 'Seq Scan' && n['Relation Name'] === 'Transaction',
  );
  const uses = scans
    .map((n) => n['Index Name'] ?? `${n['Node Type']}(${n['Relation Name'] ?? ''})`)
    .join(', ');
  const verdict = seq.length > 0 && expect === 'index' ? 'SEQ SCAN' : 'ok';
  console.log(
    `${verdict.padEnd(8)} ${plan['Execution Time'].toFixed(1).padStart(8)} ms  ${label}\n${' '.repeat(20)}${uses}`,
  );
  return verdict === 'ok';
}

async function main() {
  await db.user.deleteMany({ where: { email: EMAIL } });
  console.log(`Loading ${ROWS.toLocaleString()} transactions...`);
  const u = await db.user.create({
    data: { email: EMAIL, passwordHash: 'x', name: 'Explain', currency: 'USD', timezone: 'UTC' },
  });
  const accounts = await Promise.all(
    ['Checking', 'Savings', 'Card'].map((name) =>
      db.account.create({ data: { userId: u.id, name, type: 'bank', currency: 'USD' } }),
    ),
  );
  const cats = await Promise.all(
    ['Food', 'Rent', 'Fun', 'Travel', 'Health', 'Misc'].map((name) =>
      db.category.create({ data: { userId: u.id, name, type: 'expense' } }),
    ),
  );
  const acc = accounts.map((a) => `'${a.id}'`).join(',');
  const cat = cats.map((c) => `'${c.id}'`).join(',');
  // Spread over ~8 years so date-range queries select a realistic slice.
  await db.$executeRawUnsafe(`
    INSERT INTO "Transaction" (id, "userId", "accountId", "categoryId", type, amount, currency, description, date, "updatedAt", "importHash")
    SELECT 'ex' || g, '${u.id}',
      (ARRAY[${acc}])[1 + (g % 3)],
      (ARRAY[${cat}])[1 + (g % 6)],
      'expense', 100 + (g % 9000), 'USD',
      (ARRAY['Groceries','Coffee','Rent','Netflix','Fuel','Lunch','Pharmacy','Taxi'])[1 + (g % 8)] || ' ' || g,
      DATE '2018-01-01' + (g % 2900), now(), md5(g::text)
    FROM generate_series(1, ${ROWS}) g`);
  await db.$executeRawUnsafe(`ANALYZE "Transaction"`);

  const U = `'${u.id}'`;
  const results: boolean[] = [];
  console.log('\nPlans against', ROWS.toLocaleString(), 'rows:\n');
  results.push(
    await explain(
      'Transactions list (newest 25)',
      `SELECT * FROM "Transaction" WHERE "userId" = ${U} ORDER BY date DESC, "createdAt" DESC LIMIT 25`,
    ),
    await explain(
      'Transactions list, one account',
      `SELECT * FROM "Transaction" WHERE "userId" = ${U} AND "accountId" = '${accounts[0]!.id}' ORDER BY date DESC LIMIT 25`,
    ),
    await explain(
      'Transactions list, one category',
      `SELECT * FROM "Transaction" WHERE "userId" = ${U} AND "categoryId" IN ('${cats[0]!.id}') ORDER BY date DESC LIMIT 25`,
    ),
    await explain(
      'Dashboard / analytics: this month',
      `SELECT date, type, amount, "categoryId" FROM "Transaction" WHERE "userId" = ${U} AND date BETWEEN '2025-10-01' AND '2025-10-31'`,
    ),
    await explain(
      'Calendar: 6 weeks',
      `SELECT * FROM "Transaction" WHERE "userId" = ${U} AND date BETWEEN '2025-09-28' AND '2025-11-08' ORDER BY date, "createdAt"`,
    ),
    await explain(
      'Analytics: one year of expenses',
      `SELECT date, amount, "categoryId" FROM "Transaction" WHERE "userId" = ${U} AND type = 'expense' AND date BETWEEN '2025-01-01' AND '2025-12-31'`,
    ),
    await explain(
      'Import duplicate check (500 fingerprints)',
      `SELECT "importHash" FROM "Transaction" WHERE "userId" = ${U} AND "importHash" IN (${Array.from({ length: 500 }, (_, i) => `md5('${i + 1}')`).join(',')})`,
    ),
    await explain(
      'Count for pagination',
      `SELECT count(*) FROM "Transaction" WHERE "userId" = ${U} AND type = 'expense'`,
      'any',
    ),
    await explain(
      'Text search (contains, case-insensitive)',
      `SELECT * FROM "Transaction" WHERE "userId" = ${U} AND description ILIKE '%pharmacy 1%' ORDER BY date DESC LIMIT 6`,
      'any',
    ),
    await explain(
      'Account balance reconcile (sum per account)',
      `SELECT "accountId", sum(amount) FROM "Transaction" WHERE "userId" = ${U} GROUP BY "accountId"`,
      'any',
    ),
  );
  console.log(
    '\nQueries marked "any" read a large share of the table by nature (counts, sums, substring search);\nthey are fine at personal scale and are the candidates for pg_trgm / summary tables if they ever matter.',
  );

  await db.user.deleteMany({ where: { email: EMAIL } });
  await db.$disconnect();
  if (results.includes(false)) process.exitCode = 1;
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await db.user.deleteMany({ where: { email: EMAIL } }).catch(() => undefined);
  await db.$disconnect();
  process.exit(1);
});
