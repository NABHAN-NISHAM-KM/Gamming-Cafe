import { BadRequestException, ConflictException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import type { PlatformClient } from "@arena/db";
import { hashSecret } from "../auth/crypto.js";

export interface NewOrganization {
  displayName: string;
  legalName?: string;
  slug: string;
  countryCode: string;
  planId: string;
  trialDays: number;
  ownerEmail: string;
  ownerName: string;
  /** Self-serve sign-up: the owner chose a password. Otherwise new owners get a temporary one. */
  ownerPassword?: string;
  /** Self-serve sign-up: a branch, zones and a rate card to start from. */
  sampleVenue?: boolean;
}

/**
 * Opens a venue: organization, brand, subscription (trial or active), and its
 * owner with the owner role. Used by the Super Admin and by the website's
 * free-trial sign-up. One transaction: all of it or none.
 */
export async function provisionOrganization(db: PlatformClient, i: NewOrganization) {
  const [country, plan, ownerRole] = await Promise.all([
    db.country.findUnique({ where: { code: i.countryCode } }),
    db.subscriptionPlan.findUnique({ where: { id: i.planId } }),
    db.role.findFirst({ where: { organizationId: null, key: "org_owner" } }),
  ]);
  if (!country) throw new BadRequestException({ error: "validation_failed", issues: [{ path: "countryCode", message: "Unknown country" }] });
  if (!plan || !plan.isActive) throw new BadRequestException({ error: "validation_failed", issues: [{ path: "planId", message: "Unknown or retired plan" }] });
  if (!ownerRole) throw new Error("org_owner role template missing — run the seed");
  if (await db.organization.findUnique({ where: { slug: i.slug }, select: { id: true } })) throw new ConflictException({ error: "slug_taken" });

  const existing = await db.user.findUnique({ where: { email: i.ownerEmail } });
  const tempPassword = existing || i.ownerPassword ? null : `Arena-${randomBytes(9).toString("base64url")}`;
  const secret = i.ownerPassword ?? tempPassword;
  const passwordHash = secret ? await hashSecret(secret) : null;
  const now = new Date();
  const trial = i.trialDays > 0;

  const org = await db.$transaction(async (t) => {
    const org = await t.organization.create({
      data: {
        slug: i.slug, displayName: i.displayName, legalName: i.legalName ?? i.displayName, status: trial ? "TRIAL" : "ACTIVE",
        countryCode: country.code, defaultCurrency: country.defaultCurrency, defaultTimezone: country.defaultTimezone, defaultLocale: country.defaultLocale,
        supportedLocales: [...new Set([country.defaultLocale, "en"])], billingEmail: i.ownerEmail,
      },
    });
    const brand = await t.brand.create({ data: { organizationId: org.id, name: i.displayName } });
    await t.subscription.create({
      data: {
        organizationId: org.id, planId: plan.id, status: trial ? "TRIALING" : "ACTIVE",
        currentPeriodStart: now, currentPeriodEnd: new Date(now.getTime() + (trial ? i.trialDays : 30) * 86_400_000),
      },
    });
    const user = existing ?? (await t.user.create({ data: { email: i.ownerEmail, displayName: i.ownerName, passwordHash, mfaRequired: true } }));
    const emp = await t.employee.create({ data: { organizationId: org.id, userId: user.id, employeeCode: "E001", displayName: i.ownerName, status: "ACTIVE", hiredAt: now } });
    await t.employeeRoleAssignment.create({ data: { organizationId: org.id, employeeId: emp.id, roleId: ownerRole.id, scope: "ORGANIZATION" } });

    if (i.sampleVenue) {
      // Somewhere to start: one branch, two PC zones and a rate card with packages. Everything can be renamed or removed.
      const branch = await t.branch.create({
        data: { organizationId: org.id, brandId: brand.id, code: "MAIN", name: "Main branch", status: "SETUP", countryCode: country.code, currency: country.defaultCurrency, timezone: country.defaultTimezone, openingHours: {} },
      });
      for (const [n, [name, type]] of ([["Regular PCs", "PC_STANDARD"], ["VIP PCs", "PC_VIP"]] as const).entries()) {
        await t.zone.create({ data: { organizationId: org.id, branchId: branch.id, name, type, sortOrder: n } });
      }
      const rate = await t.pricingPlan.create({ data: { organizationId: org.id, name: "Regular PC", currency: country.defaultCurrency, stationClass: "PC", billingMode: "PER_HOUR", rate: "15" } });
      for (const [n, [name, minutes, price]] of ([["1 hour", 60, 15], ["3 hours", 180, 40], ["5 hours", 300, 60]] as const).entries()) {
        await t.pricingPackage.create({ data: { organizationId: org.id, pricingPlanId: rate.id, name, durationMinutes: minutes, price, bonusMinutes: 0, sortOrder: n } });
      }
    }
    return org;
  });
  return { organization: { id: org.id, slug: org.slug, displayName: org.displayName }, owner: { email: i.ownerEmail, existingAccount: !!existing, tempPassword }, plan };
}
