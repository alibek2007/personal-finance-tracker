import type { Prisma } from '@prisma/client';
import type { Db } from '../../lib/db';

export interface AuditEvent {
  userId?: string | null;
  action: string;
  entity?: string;
  entityId?: string;
  ip?: string | undefined;
  userAgent?: string | undefined;
  /** Never put secrets, tokens or full request bodies here. */
  metadata?: Prisma.InputJsonValue;
}

/** Audit writes must never break the user's request. */
export async function audit(db: Db, event: AuditEvent): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        userId: event.userId ?? null,
        action: event.action,
        entity: event.entity ?? null,
        entityId: event.entityId ?? null,
        ip: event.ip ?? null,
        userAgent: event.userAgent?.slice(0, 255) ?? null,
        ...(event.metadata !== undefined ? { metadata: event.metadata } : {}),
      },
    });
  } catch (error) {
    console.error('audit log write failed', error instanceof Error ? error.message : error);
  }
}
