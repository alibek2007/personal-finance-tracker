import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import type { TestProject } from 'vitest/node';
import { PrismaClient } from '@prisma/client';
import { startEmbeddedPostgres, type EmbeddedPg } from '../scripts/embedded-pg';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Connection string for the `postgres` maintenance database (used to create/drop per-file databases). */
    adminUrl: string;
    /** Name of the fully migrated template database each test file clones. */
    templateDb: string;
  }
}

const root = resolve(import.meta.dirname, '../../..');
const TEMPLATE = 'pfm_template';
let pg: EmbeddedPg | undefined;

function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

/**
 * Integration tests run against real PostgreSQL.
 * - TEST_DATABASE_URL set: use that server (the role needs CREATEDB).
 * - otherwise: boot a throwaway embedded instance.
 * We migrate ONE template database here; every test file then clones it (see test/setup.ts),
 * so files can run in parallel without ever touching each other's rows.
 */
export default async function setup(project: TestProject) {
  let serverUrl = process.env.TEST_DATABASE_URL;
  if (!serverUrl) {
    pg = await startEmbeddedPostgres({
      dataDir: resolve(root, '.pgdata-test'),
      port: 54330,
      fresh: true,
    });
    serverUrl = pg.url('postgres');
  }
  const adminUrl = withDatabase(serverUrl, 'postgres');

  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${TEMPLATE} WITH (FORCE)`);
  await admin.$executeRawUnsafe(`CREATE DATABASE ${TEMPLATE}`);
  await admin.$disconnect();

  execFileSync(
    process.execPath,
    [resolve(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'],
    {
      cwd: resolve(root, 'apps/api'),
      env: { ...process.env, DATABASE_URL: withDatabase(serverUrl, TEMPLATE) },
      stdio: 'pipe',
    },
  );

  project.provide('adminUrl', adminUrl);
  project.provide('templateDb', TEMPLATE);

  return async () => {
    await pg?.stop();
  };
}
