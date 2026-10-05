import { Injectable, NotFoundException } from "@nestjs/common";
import type { TenantTx } from "@arena/db";
import type { Target } from "@arena/rbac";
import { uuidParam } from "./zod.pipe.js";

/**
 * Derives the authorization target from the resource a route touches — never
 * from client-supplied body fields. Lookups run under RLS, so another org's
 * resource is simply "not found" (404), which also avoids existence leaks.
 */
@Injectable()
export class TargetResolver {
  async resolve(tx: TenantTx, organizationId: string, params: Record<string, string | undefined>): Promise<Target> {
    const id = (name: string) => {
      const v = params[name];
      if (v === undefined) return undefined;
      if (!uuidParam.test(v)) throw new NotFoundException({ error: "not_found" });
      return v;
    };

    const branchTarget = async (branchId: string): Promise<Target> => {
      const b = await tx.branch.findUnique({ where: { id: branchId }, select: { id: true, brandId: true } });
      if (!b) throw new NotFoundException({ error: "not_found" });
      return { organizationId, brandId: b.brandId, branchId: b.id };
    };

    const branchId = id("branchId");
    if (branchId) return branchTarget(branchId);

    const zoneId = id("zoneId");
    if (zoneId) {
      const z = await tx.zone.findUnique({ where: { id: zoneId }, select: { branchId: true } });
      if (!z) throw new NotFoundException({ error: "not_found" });
      return branchTarget(z.branchId);
    }

    const deviceId = id("deviceId");
    if (deviceId) {
      const d = await tx.device.findUnique({ where: { id: deviceId }, select: { branchId: true } });
      if (!d) throw new NotFoundException({ error: "not_found" });
      return branchTarget(d.branchId);
    }

    const billId = id("billId");
    if (billId) {
      const b = await tx.bill.findUnique({ where: { id: billId }, select: { branchId: true } });
      if (!b) throw new NotFoundException({ error: "not_found" });
      return branchTarget(b.branchId);
    }
    const sessionId = id("sessionId");
    if (sessionId) {
      const s = await tx.gamingSession.findUnique({ where: { id: sessionId }, select: { branchId: true } });
      if (!s) throw new NotFoundException({ error: "not_found" });
      return branchTarget(s.branchId);
    }

    const alertId = id("alertId");
    if (alertId) {
      const a = await tx.alert.findUnique({ where: { id: alertId }, select: { branchId: true } });
      if (!a) throw new NotFoundException({ error: "not_found" });
      return a.branchId ? branchTarget(a.branchId) : { organizationId };
    }

    const employeeId = id("employeeId");
    if (employeeId) {
      const e = await tx.employee.findUnique({ where: { id: employeeId }, select: { homeBranchId: true } });
      if (!e) throw new NotFoundException({ error: "not_found" });
      return e.homeBranchId ? branchTarget(e.homeBranchId) : { organizationId };
    }

    const brandId = id("brandId");
    if (brandId) {
      const b = await tx.brand.findUnique({ where: { id: brandId }, select: { id: true } });
      if (!b) throw new NotFoundException({ error: "not_found" });
      return { organizationId, brandId: b.id };
    }

    return { organizationId };
  }
}
