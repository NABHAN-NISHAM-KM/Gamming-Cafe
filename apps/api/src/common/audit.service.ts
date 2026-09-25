import { Injectable } from "@nestjs/common";
import type { TenantTx } from "@arena/db";
import { state, tx } from "./request-state.js";

export interface AuditEntry {
  action: string; // "branch.create", "employee.assign_role"…
  entityType: string;
  entityId?: string | null;
  branchId?: string | null;
  before?: unknown;
  after?: unknown;
}

/**
 * Writes to the hash-chained AuditLog inside the request transaction, so an
 * audit row exists if and only if the change committed.
 */
@Injectable()
export class AuditService {
  async record(e: AuditEntry): Promise<void> {
    const s = state();
    await tx().auditLog.create({
      data: {
        branchId: e.branchId ?? null,
        actorType: "EMPLOYEE",
        actorId: s.principal.employeeId,
        actorRole: s.decision?.viaRole ?? null,
        impersonatorId: s.principal.impersonatorId ?? null,
        action: e.action,
        entityType: e.entityType,
        entityId: e.entityId ?? null,
        before: toJson(e.before),
        after: toJson(e.after),
        reason: s.reason,
        ip: s.ip,
        userAgent: s.userAgent,
        requestId: s.requestId,
        hash: "", // computed by the audit_hash_chain trigger
      },
    });
  }
}

/**
 * Audit for work done outside a staff request (session timer, device, customer
 * self-service). Same table and hash chain; the actor is recorded explicitly.
 */
export async function auditAs(
  t: TenantTx,
  actor: { type: "EMPLOYEE" | "SYSTEM" | "DEVICE" | "CUSTOMER"; id: string | null },
  e: AuditEntry & { reason?: string | null },
): Promise<void> {
  await t.auditLog.create({
    data: {
      branchId: e.branchId ?? null,
      actorType: actor.type,
      actorId: actor.id,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId ?? null,
      before: toJson(e.before),
      after: toJson(e.after),
      reason: e.reason ?? null,
      hash: "",
    },
  });
}

const REDACT = new Set(["passwordHash", "pinHash", "rfidTagHash", "secretEnc", "tokenHash"]);

function toJson(v: unknown): any {
  if (v === undefined || v === null) return undefined;
  return JSON.parse(JSON.stringify(v, (k, val) => (REDACT.has(k) ? "[redacted]" : typeof val === "bigint" ? val.toString() : val)));
}
