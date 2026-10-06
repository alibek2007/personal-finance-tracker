import { hash, verify, type Algorithm } from '@node-rs/argon2';

// OWASP-recommended Argon2id baseline (19 MiB, t=2, p=1).
const ARGON_OPTIONS = {
  algorithm: 2 as Algorithm, // Argon2id (const enum cannot be imported under isolatedModules)
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON_OPTIONS);
}

export async function verifyPassword(passwordHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(passwordHash, plain);
  } catch {
    return false; // malformed hash must never throw into the request path
  }
}

// Pre-computed hash used to equalise timing when the email does not exist.
let dummyHash: Promise<string> | undefined;
export async function burnPasswordCheck(plain: string): Promise<void> {
  dummyHash ??= hashPassword('not-a-real-password');
  await verifyPassword(await dummyHash, plain);
}
