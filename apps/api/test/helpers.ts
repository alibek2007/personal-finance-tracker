import { buildApp } from '../src/app';
import { loadEnv, type Env } from '../src/config/env';
import { createDb, type Db } from '../src/lib/db';
import { MemoryMailer } from '../src/lib/mailer';
import { hashPassword } from '../src/lib/password';
import { getTestDatabaseUrl } from './setup';

export function testEnv(overrides: Record<string, string> = {}): Env {
  return loadEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: getTestDatabaseUrl(),
    SESSION_SECRET: 'test-secret-test-secret-test-secret-123456',
    WEB_ORIGINS: 'http://localhost:5173',
    AUTH_RATE_LIMIT_MAX: '1000',
    ...overrides,
  });
}

export async function createTestApp(
  overrides: Record<string, string> = {},
  options: { now?: () => Date } = {},
) {
  const env = testEnv(overrides);
  const db = createDb(env.DATABASE_URL);
  const mailer = new MemoryMailer();
  const app = await buildApp({ env, db, mailer, ...(options.now ? { now: options.now } : {}) });
  return {
    app,
    mailer,
    db,
    env,
    async close() {
      await app.close();
      await db.$disconnect();
    },
  };
}

/** Wipes every table (FK-safe) between tests. */
export async function resetDb(db: Db): Promise<void> {
  await db.$executeRawUnsafe(
    `TRUNCATE "AuditLog","Notification","RecurringTransaction","GoalContribution","SavingsGoal","Budget","Transaction","Category","Account","AuthToken","Session","User" RESTART IDENTITY CASCADE`,
  );
}

let counter = 0;
export async function createUser(db: Db, overrides: { email?: string; name?: string } = {}) {
  counter += 1;
  return db.user.create({
    data: {
      email: overrides.email ?? `user${counter}@example.com`,
      name: overrides.name ?? `User ${counter}`,
      passwordHash: await hashPassword('correct horse battery staple'),
    },
  });
}
