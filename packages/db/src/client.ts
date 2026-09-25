import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";
import { requireTenant, runWithTenant, type TenantContext } from "./tenant-context.js";
import { isTenantModel, scopeArgs } from "./tenant-scope.js";

export interface CreateDbOptions {
  /** Runtime role connection string (member of arena_app, NOBYPASSRLS). */
  connectionString: string;
  /** Hard ceiling for a single tenant transaction. */
  transactionTimeoutMs?: number;
}

/**
 * Layer 2: every query on a tenant model is rewritten to the current tenant
 * (from AsyncLocalStorage). A query with no tenant context throws — fail closed.
 */
function tenantScoped(client: PrismaClient) {
  return client.$extends({
    name: "tenant-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!isTenantModel(model)) return query(args);
          const { organizationId } = requireTenant(model);
          return query(scopeArgs(model, operation, args as any, organizationId) as any);
        },
      },
    },
  });
}

export type TenantDb = ReturnType<typeof tenantScoped>;
export type TenantTx = Parameters<Parameters<TenantDb["$transaction"]>[0]>[0];

export function createDb({ connectionString, transactionTimeoutMs = 10_000 }: CreateDbOptions) {
  const base = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const scoped = tenantScoped(base);

  return {
    /**
     * Runs `fn` in one DB transaction bound to a tenant:
     *  - Layer 3: `app.current_org` is set with SET LOCAL semantics, so
     *    Postgres RLS filters every statement (and resets at COMMIT/ROLLBACK,
     *    making it safe with pooled connections).
     *  - Layer 2: the Prisma extension scopes every model query.
     */
    withTenant<T>(ctx: TenantContext, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
      return runWithTenant(ctx, () =>
        scoped.$transaction(
          async (tx) => {
            await tx.$executeRaw`SELECT set_config('app.current_org', ${ctx.organizationId}, true)`;
            return fn(tx);
          },
          { timeout: transactionTimeoutMs },
        ),
      );
    },

    /**
     * For work that happens before a tenant is known (login, refresh-token
     * lookup). Non-tenant models (User, RefreshToken, MfaFactor…) work; any
     * tenant model throws TenantContextMissingError, and RLS returns nothing.
     */
    global: scoped,

    /** Current tenant, for services that need it (e.g. audit). */
    tenant: () => requireTenant(),

    disconnect: () => base.$disconnect(),
  };
}

export type Db = ReturnType<typeof createDb>;

/**
 * Unscoped client for the platform (Super Admin) service and seeding. It must
 * connect as a BYPASSRLS role; never hand it to tenant-facing request code.
 */
export function createPlatformClient(connectionString: string) {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

export type PlatformClient = ReturnType<typeof createPlatformClient>;
export { Prisma } from "./generated/prisma/client.js";
