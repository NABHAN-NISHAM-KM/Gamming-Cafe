import { Controller, Get, Query } from "@nestjs/common";
import { z } from "zod";
import { RequirePermissionAnyScope } from "../common/decorators.js";
import { scopeFor } from "../common/reporting.js";
import { principal, tx } from "../common/request-state.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { overview } from "./analytics.service.js";

const Q = z.object({ days: z.coerce.number().int().refine((d) => [7, 30, 90].includes(d), "7, 30 or 90").default(30), branchId: z.uuid().optional() });

@Controller("analytics")
export class AnalyticsController {
  /** The dashboard. Trends and customer insight need the Advanced analytics feature. */
  @RequirePermissionAnyScope("reports.operational")
  @Get("overview")
  async overview(@Query(new ZodPipe(Q)) q: z.infer<typeof Q>) {
    const org = await tx().organization.findFirstOrThrow({ select: { defaultTimezone: true } });
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: org.defaultTimezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    return overview(tx(), await scopeFor("reports.operational", q.branchId), { today, days: q.days, advanced: principal().features.has("ADVANCED_REPORTS") });
  }
}
