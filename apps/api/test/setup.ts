import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, inject } from 'vitest';
import { PrismaClient } from '@prisma/client';

const KEY = '__PFM_TEST_DATABASE_URL__';

/** The private database created for the test file currently running. */
export function getTestDatabaseUrl(): string {
  const url = (globalThis as Record<string, unknown>)[KEY];
  if (typeof url !== 'string') throw new Error('Test database not ready: setup.ts did not run');
  return url;
}

// Runs before each test file's own hooks: clone the migrated template into a private database.
let databaseName = '';
beforeAll(async () => {
  const adminUrl = inject('adminUrl');
  databaseName = `pfm_t_${randomBytes(6).toString('hex')}`;
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  try {
    await admin.$executeRawUnsafe(
      `CREATE DATABASE ${databaseName} TEMPLATE ${inject('templateDb')}`,
    );
  } finally {
    await admin.$disconnect();
  }
  const url = new URL(adminUrl);
  url.pathname = `/${databaseName}`;
  (globalThis as Record<string, unknown>)[KEY] = url.toString();
}, 60_000);

afterAll(async () => {
  const admin = new PrismaClient({ datasources: { db: { url: inject('adminUrl') } } });
  try {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
  } finally {
    await admin.$disconnect();
  }
}, 60_000);
