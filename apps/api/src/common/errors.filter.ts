import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import type { Response } from "express";
import { Prisma, TenantContextMissingError, TenantViolationError } from "@arena/db";
import { ForbiddenError } from "@arena/rbac";

/** Maps domain errors to HTTP without leaking internals or cross-tenant existence. */
@Catch()
export class ErrorsFilter implements ExceptionFilter {
  private readonly log = new Logger("Errors");

  catch(err: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const send = (status: number, body: Record<string, unknown>) => res.status(status).json(body);

    if (err instanceof HttpException) {
      const body = err.getResponse();
      return send(err.getStatus(), typeof body === "string" ? { error: body } : (body as Record<string, unknown>));
    }
    if (err instanceof ForbiddenError) {
      return send(403, { error: "forbidden", permission: err.permission, reason: err.reason });
    }
    // Another tenant's resource is indistinguishable from a missing one.
    if (err instanceof TenantViolationError) return send(404, { error: "not_found" });
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2025") return send(404, { error: "not_found" });
      if (err.code === "P2002") return send(409, { error: "conflict", fields: (err.meta as any)?.target ?? null });
      if (err.code === "P2003") return send(409, { error: "invalid_reference" });
    }
    if (err instanceof TenantContextMissingError) this.log.error("Tenant context missing — programming error", err.stack);
    else this.log.error(err instanceof Error ? err.stack : String(err));
    return send(500, { error: "internal_error" });
  }
}
