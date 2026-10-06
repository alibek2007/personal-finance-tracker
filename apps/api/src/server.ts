import { buildApp } from './app';
import { loadEnv } from './config/env';
import { createDb } from './lib/db';

async function main() {
  const env = loadEnv();
  const db = createDb(env.DATABASE_URL);
  const app = await buildApp({ env, db });

  // Record recurring payments as they come due. Idempotent, so overlapping runs or several API
  // instances are harmless; the database refuses a second payment for the same day.
  const runRecurring = () =>
    app.recurring
      .materializeAll()
      .then(
        ({ users, created }) =>
          created > 0 && app.log.info({ users, created }, 'recorded recurring payments'),
      )
      .catch((err) => app.log.error({ err }, 'recurring job failed'));
  const recurringTimer = setInterval(() => void runRecurring(), 10 * 60 * 1000);
  recurringTimer.unref();

  const shutdown = async (signal: string) => {
    clearInterval(recurringTimer);
    app.log.info({ signal }, 'shutting down');
    await app.close();
    await db.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: env.API_HOST, port: env.API_PORT });
  void runRecurring();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
