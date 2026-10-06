import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { request, type FullConfig } from '@playwright/test';

const root = resolve(import.meta.dirname, '..');
export const DEMO_EMAIL = 'alex@example.com';
export const DEMO_PASSWORD = 'demo-password-123';
export const DEMO_STATE = resolve(root, 'e2e/.auth/alex.json');

/** Starts the database child, waits until it is migrated and seeded, signs the demo user in once. */
export default async function globalSetup(config: FullConfig) {
  const child: ChildProcess = spawn(
    process.execPath,
    ['--import', 'tsx', resolve(root, 'e2e/support/db.ts')],
    { cwd: root, stdio: ['pipe', 'pipe', 'inherit'] },
  );
  await new Promise<void>((resolveReady, reject) => {
    let out = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString();
      if (out.includes('READY')) resolveReady();
    });
    child.once('exit', (code) => reject(new Error(`e2e database exited early (${code})\n${out}`)));
    setTimeout(
      () => reject(new Error(`e2e database was not ready in 120s\n${out}`)),
      120_000,
    ).unref();
  });

  // The API started in parallel with the database; wait for it to be able to talk to it.
  const baseURL = config.projects[0]!.use.baseURL!;
  const api = await request.newContext({
    baseURL,
    extraHTTPHeaders: { 'x-requested-with': 'pfm', origin: baseURL },
  });
  const login = await api.post('/api/auth/login', {
    data: { email: DEMO_EMAIL, password: DEMO_PASSWORD },
  });
  if (!login.ok())
    throw new Error(`Could not sign in the demo user: ${login.status()} ${await login.text()}`);
  mkdirSync(resolve(root, 'e2e/.auth'), { recursive: true });
  await api.storageState({ path: DEMO_STATE });
  await api.dispose();

  return async () => {
    child.stdin?.write('stop\n');
    await new Promise<void>((done) => {
      child.once('exit', () => done());
      setTimeout(() => {
        child.kill();
        done();
      }, 20_000).unref();
    });
  };
}
