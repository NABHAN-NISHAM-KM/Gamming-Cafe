import { ForbiddenException, NotFoundException } from "@nestjs/common";
import type { Response } from "express";
import { authorizeAnywhere, branchesWith, type PermissionKey } from "@arena/rbac";
import { csvName, toCsv } from "./csv.js";
import { principal, tx } from "./request-state.js";

/**
 * Shared by the finance and report endpoints: which branches the caller may
 * see, the default period, and CSV output.
 */

/** null = the whole organization (including rows not tied to a branch), else these branches. */
export interface BranchScope {
  branchIds: string[] | null;
}

const localDay = (at: Date, timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);

/** Branches the caller sees with `permission` — narrowed to one branch when asked (and allowed). */
export async function scopeFor(permission: PermissionKey, branchId?: string): Promise<BranchScope> {
  const branches = await tx().branch.findMany({ select: { id: true, brandId: true } });
  const allowed = branchesWith(principal(), permission, (id) => branches.find((b) => b.id === id)?.brandId ?? undefined, branches.map((b) => b.id));
  if (!branchId) return { branchIds: allowed };
  if (!branches.some((b) => b.id === branchId)) throw new NotFoundException({ error: "branch_not_found" });
  if (allowed !== null && !allowed.includes(branchId)) throw new ForbiddenException({ error: "forbidden", permission, reason: "OUT_OF_SCOPE" });
  return { branchIds: [branchId] };
}

/** Default period: this month to today, in the organization's time zone. */
export async function period(q: { from?: string; to?: string }) {
  const { defaultTimezone: timezone } = await tx().organization.findFirstOrThrow({ select: { defaultTimezone: true } });
  const today = localDay(new Date(), timezone);
  return { from: q.from ?? `${today.slice(0, 8)}01`, to: q.to ?? today };
}

/** CSV needs reports.export on top of the read permission. */
export function sendCsv(res: Response, name: string, header: string[], rows: unknown[][]) {
  // The rows are already limited to the caller's branches; exporting them needs the right somewhere.
  const d = authorizeAnywhere(principal(), "reports.export");
  if (!d.allowed) throw new ForbiddenException({ error: "forbidden", permission: "reports.export", reason: d.reason });
  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader("content-disposition", `attachment; filename="${csvName(name)}"`);
  return toCsv(header, rows);
}
