/**
 * Starts a real PostgreSQL (embedded binaries) for local development when Docker is unavailable.
 * Data persists in <repo>/.pgdata. Credentials match .env.example.
 */
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { startEmbeddedPostgres } from './embedded-pg';

const PORT = Number(process.env.DEV_DB_PORT ?? 54329);
const pg = await startEmbeddedPostgres({
  dataDir: resolve(import.meta.dirname, '../../../.pgdata'),
  port: PORT,
});

// CREATE DATABASE has no IF NOT EXISTS; create what is missing.
const admin = new PrismaClient({ datasources: { db: { url: pg.url('postgres') } } });
for (const name of ['pfm', 'pfm_test']) {
  const rows = await admin.$queryRaw<
    { n: number }[]
  >`SELECT 1 AS n FROM pg_database WHERE datname = ${name}`;
  if (rows.length === 0) await admin.$executeRawUnsafe(`CREATE DATABASE ${name}`);
}
await admin.$disconnect();

console.log(`PostgreSQL ready: ${pg.url('pfm')}`);
console.log('Press Ctrl+C to stop.');

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
setInterval(() => undefined, 1 << 30);
