import { prisma } from "../config/prisma";

export interface AuditActor {
  userId?: string;
  role?: string;
}

export interface AuditEntry {
  templeId?: string | null;
  festivalId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  before?: Record<string, any> | null;
  after?: Record<string, any> | null;
}

const IGNORED = new Set(["updatedAt", "createdAt"]);

/** Field-level changes between two snapshots, e.g. { price: [100, 150] }. */
export function diff(before?: Record<string, any> | null, after?: Record<string, any> | null) {
  if (!before || !after) return null;
  const changes: Record<string, [unknown, unknown]> = {};
  for (const key of Object.keys(after)) {
    if (IGNORED.has(key) || typeof after[key] === "object" && after[key] !== null && !(after[key] instanceof Date)) continue;
    const a = before[key] instanceof Date ? before[key].toISOString() : before[key];
    const b = after[key] instanceof Date ? after[key].toISOString() : after[key];
    if (a !== b) changes[key] = [a ?? null, b ?? null];
  }
  return Object.keys(changes).length ? changes : null;
}

/** Records an admin action. Never throws, so it can't break the request that triggered it. */
export async function logAudit(actor: AuditActor, entry: AuditEntry): Promise<void> {
  try {
    const user = actor.userId ? await prisma.user.findUnique({ where: { id: actor.userId }, select: { name: true } }) : null;
    const changes = entry.before || entry.after ? diff(entry.before, entry.after) ?? (entry.before ? null : entry.after) : null;
    await prisma.auditLog.create({
      data: {
        actorId: actor.userId ?? null,
        actorName: user?.name ?? null,
        actorRole: actor.role ?? null,
        templeId: entry.templeId ?? null,
        festivalId: entry.festivalId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        summary: entry.summary.slice(0, 500),
        changes: changes ? JSON.stringify(changes).slice(0, 4000) : null,
      },
    });
  } catch (err: any) {
    console.error(`[AUDIT] Failed to record "${entry.action}": ${err.message}`);
  }
}
