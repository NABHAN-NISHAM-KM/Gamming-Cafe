import { Body, ConflictException, Controller, Get, HttpCode, HttpException, Inject, Logger, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import type { PlatformClient } from "@arena/db";
import { ZodPipe } from "../common/zod.pipe.js";
import { PDB, PLATFORM_CONFIG, type PlatformConfig } from "./config.js";
import { PlatformPublic } from "./guard.js";
import { provisionOrganization } from "./provision.js";

/** Sliding-window counter per key (per IP). */
class Throttle {
  private readonly hits = new Map<string, number[]>();
  constructor(private readonly max: number, private readonly windowMs: number) {}
  take(key: string) {
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) return false;
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }
}

const text = (max: number) => z.string().trim().max(max);
const optional = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null);
const Contact = z
  .object({
    name: text(120).min(2),
    email: z.email().max(254).toLowerCase(),
    phone: optional(30),
    venue: optional(120),
    country: optional(60),
    venueType: optional(40),
    plan: optional(20),
    branches: z.coerce.number().int().min(1).max(1000).nullish(),
    stations: z.coerce.number().int().min(1).max(100_000).nullish(),
    notes: optional(2000),
    source: optional(80),
    /** Honeypot: people never see this field; bots fill it in. */
    website: z.string().max(200).optional(),
  })
  .strip();
const Demo = Contact.extend({ demoAt: z.iso.datetime({ offset: true }) });
const Trial = z
  .object({
    venueName: text(120).min(2),
    slug: z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/, "3–40 lowercase letters, digits or dashes"),
    countryCode: z.string().length(2).toUpperCase(),
    ownerName: text(120).min(2),
    email: z.email().max(254).toLowerCase(),
    password: z.string().min(10).max(128),
    venueType: optional(40),
    phone: optional(30),
    website: z.string().max(200).optional(),
  })
  .strip();

const SLOT_MIN = 30;
const DAY_MS = 86_400_000;

/** The UTC instant of a wall-clock time in a time zone (handles any offset, no DST library). */
function zoned(y: number, m: number, d: number, h: number, min: number, tz: string) {
  const guess = Date.UTC(y, m, d, h, min);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" }).formatToParts(new Date(guess)).map((p) => [p.type, p.value]));
  const asIfUtc = Date.UTC(Number(parts["year"]), Number(parts["month"]) - 1, Number(parts["day"]), Number(parts["hour"]), Number(parts["minute"]));
  return new Date(guess - (asIfUtc - guess));
}

/**
 * The marketing website's own endpoints: "Request a walkthrough", booking a
 * call, the free trial, and the current client releases. No sign-in; each is
 * throttled per IP and has a honeypot field. New leads are logged and, when
 * LEADS_WEBHOOK_URL is set, posted there (Slack, e-mail relay, CRM…).
 */
@Controller("public")
export class PlatformPublicController {
  private readonly log = new Logger("Leads");
  private readonly leadLimit = new Throttle(5, 60 * 60_000);
  private readonly trialLimit = new Throttle(3, 24 * 60 * 60_000);

  constructor(
    @Inject(PDB) private readonly db: PlatformClient,
    @Inject(PLATFORM_CONFIG) private readonly cfg: PlatformConfig,
  ) {}

  private gate(req: Request, limit: Throttle, honeypot?: string) {
    if (honeypot) throw new HttpException({ error: "rejected" }, 400);
    if (!limit.take(req.ip ?? "?")) throw new HttpException({ error: "too_many_attempts" }, 429);
  }

  private async notify(lead: { id: string; kind: string; name: string; email: string; venue: string | null; demoAt?: Date | null }) {
    this.log.log(`New ${lead.kind.toLowerCase()} lead: ${lead.name} <${lead.email}>${lead.venue ? ` · ${lead.venue}` : ""}${lead.demoAt ? ` · call ${lead.demoAt.toISOString()}` : ""}`);
    if (!this.cfg.LEADS_WEBHOOK_URL) return;
    await fetch(this.cfg.LEADS_WEBHOOK_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "lead", lead }), signal: AbortSignal.timeout(5000) }).catch((e) => this.log.warn(`webhook failed: ${e}`));
  }

  @PlatformPublic()
  @Post("leads")
  @HttpCode(201)
  async contact(@Body(new ZodPipe(Contact)) body: z.infer<typeof Contact>, @Req() req: Request) {
    this.gate(req, this.leadLimit, body.website);
    const { website: _w, ...data } = body;
    const lead = await this.db.lead.create({ data: { ...data, kind: "CONTACT", branches: data.branches ?? null, stations: data.stations ?? null, ip: req.ip ?? null } });
    await this.notify(lead);
    return { ok: true };
  }

  /** Free 30-minute call slots for the next two weeks, Sunday–Thursday 10:00–17:30 in the sales team's time zone. */
  @PlatformPublic()
  @Get("demo-slots")
  async slots(@Query("days") days?: string) {
    return { timeZone: this.cfg.SALES_TIMEZONE, slots: await this.freeSlots(Math.min(21, Math.max(1, Number(days) || 14))) };
  }

  private async freeSlots(days: number) {
    const tz = this.cfg.SALES_TIMEZONE;
    const now = Date.now();
    const out: string[] = [];
    for (let i = 0; i <= days; i++) {
      const local = new Date(now + i * DAY_MS).toLocaleDateString("en-CA", { timeZone: tz }); // YYYY-MM-DD there
      const [y, m, d] = local.split("-").map(Number) as [number, number, number];
      const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 5 = Friday, 6 = Saturday
      if (weekday === 5 || weekday === 6) continue;
      for (let min = 10 * 60; min <= 17 * 60 + 30; min += SLOT_MIN) {
        const at = zoned(y, m - 1, d, Math.floor(min / 60), min % 60, tz);
        if (at.getTime() > now + 2 * 3_600_000) out.push(at.toISOString());
      }
    }
    const taken = new Set((await this.db.lead.findMany({ where: { kind: "DEMO", status: { not: "LOST" }, demoAt: { in: out.map((s) => new Date(s)) } }, select: { demoAt: true } })).map((l) => l.demoAt!.toISOString()));
    return out.filter((s) => !taken.has(s));
  }

  @PlatformPublic()
  @Post("demo")
  @HttpCode(201)
  async bookDemo(@Body(new ZodPipe(Demo)) body: z.infer<typeof Demo>, @Req() req: Request) {
    this.gate(req, this.leadLimit, body.website);
    const at = new Date(body.demoAt).toISOString();
    if (!(await this.freeSlots(21)).includes(at)) throw new ConflictException({ error: "slot_taken" });
    const { website: _w, demoAt: _d, ...data } = body;
    try {
      const lead = await this.db.lead.create({ data: { ...data, kind: "DEMO", demoAt: new Date(at), branches: data.branches ?? null, stations: data.stations ?? null, ip: req.ip ?? null } });
      await this.notify(lead);
      return { ok: true, demoAt: at };
    } catch (e) {
      if (String(e).includes("lead_one_demo_per_slot")) throw new ConflictException({ error: "slot_taken" });
      throw e;
    }
  }

  /** Self-serve sign-up: a venue on a 14-day trial with a starter branch, zones and a rate card. */
  @PlatformPublic()
  @Post("trial")
  @HttpCode(201)
  async trial(@Body(new ZodPipe(Trial)) body: z.infer<typeof Trial>, @Req() req: Request) {
    this.gate(req, this.trialLimit, body.website);
    if (await this.db.user.findUnique({ where: { email: body.email }, select: { id: true } })) throw new ConflictException({ error: "email_taken", hint: "You already have an ArenaOS account — sign in, or contact us to add a venue." });
    const plan = await this.db.subscriptionPlan.findUnique({ where: { code: this.cfg.TRIAL_PLAN_CODE } });
    if (!plan?.isActive) throw new HttpException({ error: "trials_closed" }, 503);
    const r = await provisionOrganization(this.db, {
      displayName: body.venueName, slug: body.slug, countryCode: body.countryCode, planId: plan.id, trialDays: 14,
      ownerEmail: body.email, ownerName: body.ownerName, ownerPassword: body.password, sampleVenue: true,
    });
    const lead = await this.db.lead.create({ data: { kind: "TRIAL", name: body.ownerName, email: body.email, phone: body.phone, venue: body.venueName, country: body.countryCode, venueType: body.venueType, plan: plan.code, trialOrgId: r.organization.id, ip: req.ip ?? null } });
    await this.notify(lead);
    return { organization: r.organization, trialDays: 14 };
  }

  /** The current stable client builds, for the downloads page. */
  @PlatformPublic()
  @Get("releases")
  async releases() {
    const rows = await this.db.clientRelease.findMany({ where: { channel: "STABLE", isRevoked: false, publishedAt: { not: null } }, orderBy: { publishedAt: "desc" }, select: { component: true, version: true, releaseNotes: true, publishedAt: true, sha256: true } });
    const latest = new Map<string, (typeof rows)[number]>();
    for (const r of rows) if (!latest.has(r.component)) latest.set(r.component, r);
    return [...latest.values()];
  }
}
