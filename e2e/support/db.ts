/**
 * Database for end-to-end runs: a throwaway embedded PostgreSQL, migrated and seeded with the demo
 * ledger. Runs as a child of Playwright's global setup, prints READY when usable, and shuts PostgreSQL
 * down cleanly when told to (a line "stop" on stdin) or when its parent goes away (stdin closes).
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { startEmbeddedPostgres } from '../../apps/api/scripts/embedded-pg';
import { createDb } from '../../apps/api/src/lib/db';
import { seedDemo } from '../../apps/api/src/modules/seed/seed-demo';

const root = resolve(import.meta.dirname, '../..');
const PORT = Number(process.env.E2E_DB_PORT ?? 54331);
const DATABASE = 'pfm_e2e';

const pg = await startEmbeddedPostgres({
  dataDir: resolve(root, '.pgdata-e2e'),
  port: PORT,
  fresh: true,
});

const admin = new PrismaClient({ datasources: { db: { url: pg.url('postgres') } } });
await admin.$executeRawUnsafe(`CREATE DATABASE ${DATABASE}`);
await admin.$disconnect();

const url = `${pg.url(DATABASE)}?schema=public`;
execFileSync(
  process.execPath,
  [resolve(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'],
  { cwd: resolve(root, 'apps/api'), env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' },
);

const db = createDb(url);
await seedDemo(db);
await db.$disconnect();

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await pg.stop();
  process.exit(0);
}
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  if (chunk.includes('stop')) void stop();
});
process.stdin.on('end', () => void stop());
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());

console.log('READY');
