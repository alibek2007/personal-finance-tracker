import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../lib/db';
import { hashToken } from '../../lib/tokens';
import { createUser, resetDb, testEnv } from '../../../test/helpers';
import { createSessionService } from './session.service';

describe('session service', () => {
  let db: Db;
  let clock: Date;
  const now = () => clock;
  const service = () => createSessionService(db, { ttlDays: 30, now });

  beforeAll(() => {
    db = createDb(testEnv().DATABASE_URL);
  });
  afterAll(async () => {
    await db.$disconnect();
  });
  beforeEach(async () => {
    await resetDb(db);
    clock = new Date('2026-10-05T12:00:00Z');
  });

  it('stores only the hash of the token', async () => {
    const user = await createUser(db);
    const { token } = await service().create(user.id);
    const rows = await db.session.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).toBe(hashToken(token));
    expect(rows[0]?.tokenHash).not.toBe(token);
  });

  it('validates a live session and returns its user', async () => {
    const user = await createUser(db);
    const { token } = await service().create(user.id);
    const result = await service().validate(token);
    expect(result?.user.id).toBe(user.id);
  });

  it('rejects unknown tokens', async () => {
    expect(await service().validate('nope')).toBeNull();
  });

  it('expires sessions and removes them', async () => {
    const user = await createUser(db);
    const { token } = await service().create(user.id);
    clock = new Date('2026-11-05T12:00:01Z'); // 31 days later
    expect(await service().validate(token)).toBeNull();
    expect(await db.session.count()).toBe(0);
  });

  it('slides the expiry when used after the touch interval', async () => {
    const user = await createUser(db);
    const { token, expiresAt } = await service().create(user.id);
    clock = new Date('2026-10-20T12:00:00Z');
    await service().validate(token);
    const row = await db.session.findFirstOrThrow();
    expect(row.expiresAt.getTime()).toBeGreaterThan(expiresAt.getTime());
  });

  it('revokes one session or all of a user’s sessions', async () => {
    const user = await createUser(db);
    const a = await service().create(user.id);
    const b = await service().create(user.id);
    await service().revoke(a.token);
    expect(await service().validate(a.token)).toBeNull();
    expect(await service().validate(b.token)).not.toBeNull();
    await service().revokeAllForUser(user.id);
    expect(await service().validate(b.token)).toBeNull();
  });

  it('does not let one user’s revoke-all touch another user', async () => {
    const u1 = await createUser(db);
    const u2 = await createUser(db);
    const s2 = await service().create(u2.id);
    await service().revokeAllForUser(u1.id);
    expect(await service().validate(s2.token)).not.toBeNull();
  });
});
