import { describe, expect, it } from "vitest";
import {
  billableMinutes,
  inWindow,
  localParts,
  nextLocalTime,
  postpaidCharge,
  quote,
  selectPlans,
  zonedToUtc,
  type PlanDef,
  type PricingContext,
} from "../src/sessions/pricing.js";

const TZ = "Asia/Dubai"; // UTC+4, no DST

const plan = (over: Partial<PlanDef> = {}): PlanDef => ({
  id: "p",
  name: "Regular PC",
  branchId: null,
  zoneId: null,
  membershipTierId: null,
  stationClass: "PC",
  billingMode: "PER_HOUR",
  paymentTiming: "PREPAID",
  rateMinor: 1500, // AED 15.00/hour
  currency: "AED",
  minMinutes: 0,
  roundingMinutes: 1,
  graceMinutes: 0,
  schedule: [],
  passStartTime: null,
  passEndTime: null,
  priority: 0,
  validFrom: null,
  validTo: null,
  isActive: true,
  packages: [],
  ...over,
});

// Tuesday 2026-09-22 15:00 Dubai = 11:00Z
const ctx = (over: Partial<PricingContext> = {}): PricingContext => ({
  branchId: "dxb1",
  zoneId: "regular",
  stationClass: "PC",
  membershipTierId: null,
  timezone: TZ,
  now: new Date("2026-09-22T11:00:00Z"),
  ...over,
});

describe("time zones", () => {
  it("reads local wall time and weekday", () => {
    expect(localParts(new Date("2026-09-22T21:30:00Z"), TZ)).toMatchObject({ weekday: "wed", hour: 1, minute: 30 });
  });

  it("converts local time to UTC, including across DST in London", () => {
    expect(zonedToUtc(2026, 9, 23, 0, 0, TZ).toISOString()).toBe("2026-09-22T20:00:00.000Z");
    expect(zonedToUtc(2026, 7, 1, 12, 0, "Europe/London").toISOString()).toBe("2026-07-01T11:00:00.000Z"); // BST
    expect(zonedToUtc(2026, 12, 1, 12, 0, "Europe/London").toISOString()).toBe("2026-12-01T12:00:00.000Z"); // GMT
  });

  it("finds the next occurrence of a local time", () => {
    expect(nextLocalTime(new Date("2026-09-22T21:30:00Z"), "06:00", TZ).toISOString()).toBe("2026-09-23T02:00:00.000Z");
    expect(nextLocalTime(new Date("2026-09-23T03:00:00Z"), "06:00", TZ).toISOString()).toBe("2026-09-24T02:00:00.000Z");
  });

  it("handles overnight windows (fri 22:00 → sat 06:00 belongs to friday)", () => {
    const w = { days: ["fri" as const], from: "22:00", to: "06:00" };
    expect(inWindow(w, new Date("2026-09-25T19:00:00Z"), TZ)).toBe(true); // fri 23:00
    expect(inWindow(w, new Date("2026-09-26T01:00:00Z"), TZ)).toBe(true); // sat 05:00
    expect(inWindow(w, new Date("2026-09-26T03:00:00Z"), TZ)).toBe(false); // sat 07:00
    expect(inWindow(w, new Date("2026-09-24T19:00:00Z"), TZ)).toBe(false); // thu 23:00
  });
});

describe("plan selection", () => {
  it("zone rate beats branch rate beats organisation rate", () => {
    const org = plan({ id: "org", rateMinor: 1500 });
    const br = plan({ id: "br", branchId: "dxb1", rateMinor: 1400 });
    const zn = plan({ id: "zn", branchId: "dxb1", zoneId: "regular", rateMinor: 1600 });
    expect(selectPlans([org, br, zn], ctx()).map((p) => p.id)).toEqual(["zn", "br", "org"]);
  });

  it("member-tier rates only apply to that tier", () => {
    const gold = plan({ id: "gold", membershipTierId: "gold", rateMinor: 1200 });
    const std = plan({ id: "std" });
    expect(selectPlans([gold, std], ctx()).map((p) => p.id)).toEqual(["std"]);
    expect(selectPlans([gold, std], ctx({ membershipTierId: "gold" }))[0]!.id).toBe("gold");
  });

  it("happy hour applies only inside its window; other zones/classes/branches are excluded", () => {
    const happy = plan({ id: "happy", rateMinor: 1000, priority: 10, schedule: [{ days: ["mon", "tue", "wed", "thu"], from: "14:00", to: "18:00" }] });
    const std = plan({ id: "std" });
    expect(selectPlans([happy, std], ctx())[0]!.id).toBe("happy"); // tue 15:00
    expect(selectPlans([happy, std], ctx({ now: new Date("2026-09-22T16:00:00Z") }))[0]!.id).toBe("std"); // tue 20:00
    expect(selectPlans([plan({ zoneId: "vip" })], ctx())).toEqual([]);
    expect(selectPlans([plan({ stationClass: "CONSOLE" })], ctx())).toEqual([]);
    expect(selectPlans([plan({ branchId: "auh1" })], ctx())).toEqual([]);
    expect(selectPlans([plan({ isActive: false })], ctx())).toEqual([]);
  });

  it("a night pass is only sold during the night", () => {
    const night = plan({ id: "night", billingMode: "NIGHT_PASS", rateMinor: 6000, passStartTime: "00:00", passEndTime: "06:00" });
    expect(selectPlans([night], ctx())).toEqual([]); // 15:00
    expect(selectPlans([night], ctx({ now: new Date("2026-09-22T21:00:00Z") }))).toHaveLength(1); // 01:00
  });
});

describe("quotes (spec examples)", () => {
  it("Regular PC 1 hour = AED 15; 2 hours = AED 30", () => {
    expect(quote(plan(), { kind: "minutes", minutes: 60 }, ctx()).totalMinor).toBe(1500);
    const q = quote(plan(), { kind: "minutes", minutes: 120 }, ctx());
    expect(q).toMatchObject({ totalMinor: 3000, minutes: 120, paymentTiming: "PREPAID" });
    expect(q.expiresAt!.toISOString()).toBe("2026-09-22T13:00:00.000Z");
  });

  it("packages: 3 hours = AED 40, 5 hours = AED 60 (+bonus minutes)", () => {
    const p = plan({
      packages: [
        { id: "3h", name: "3 hours", durationMinutes: 180, priceMinor: 4000, bonusMinutes: 0, isActive: true },
        { id: "5h", name: "5 hours", durationMinutes: 300, priceMinor: 6000, bonusMinutes: 30, isActive: true },
      ],
    });
    expect(quote(p, { kind: "package", packageId: "3h" }, ctx())).toMatchObject({ totalMinor: 4000, minutes: 180, packageId: "3h" });
    expect(quote(p, { kind: "package", packageId: "5h" }, ctx())).toMatchObject({ totalMinor: 6000, minutes: 330 });
    expect(() => quote(p, { kind: "package", packageId: "nope" }, ctx())).toThrow(/Package/);
  });

  it("night pass 00:00–06:00 = AED 60, ends at 06:00 local", () => {
    const night = plan({ billingMode: "NIGHT_PASS", rateMinor: 6000, passStartTime: "00:00", passEndTime: "06:00" });
    const q = quote(night, { kind: "pass" }, ctx({ now: new Date("2026-09-22T21:00:00Z") })); // 01:00 Dubai
    expect(q.totalMinor).toBe(6000);
    expect(q.expiresAt!.toISOString()).toBe("2026-09-23T02:00:00.000Z");
    expect(q.minutes).toBe(300);
  });

  it("per-minute with minimum charge and 15-minute rounding", () => {
    const p = plan({ billingMode: "PER_MINUTE", rateMinor: 25, minMinutes: 30, roundingMinutes: 15 });
    expect(billableMinutes(p, 10)).toBe(30);
    expect(billableMinutes(p, 31)).toBe(45);
    expect(quote(p, { kind: "minutes", minutes: 31 }, ctx())).toMatchObject({ minutes: 45, totalMinor: 1125 });
  });

  it("membership discount then manual discount, never below zero", () => {
    const q = quote(plan(), { kind: "minutes", minutes: 120 }, ctx(), { membershipDiscountPct: 10, discount: { percent: 50, reason: "promo" } });
    expect(q).toMatchObject({ grossMinor: 3000, membershipDiscountMinor: 300, manualDiscountMinor: 1350, totalMinor: 1350 });
    expect(quote(plan(), { kind: "minutes", minutes: 60 }, ctx(), { discount: { amountMinor: 99_999 } }).totalMinor).toBe(0);
  });

  it("open sessions need a postpaid rate", () => {
    expect(() => quote(plan(), { kind: "open" }, ctx())).toThrow(/advance/);
    expect(quote(plan({ paymentTiming: "POSTPAID" }), { kind: "open" }, ctx())).toMatchObject({ minutes: null, expiresAt: null, totalMinor: 0 });
  });

  it("rejects nonsense durations", () => {
    expect(() => quote(plan(), { kind: "minutes", minutes: 0 }, ctx())).toThrow();
    expect(() => quote(plan(), { kind: "minutes", minutes: 1.5 }, ctx())).toThrow();
  });
});

describe("postpaid final charge", () => {
  const p = plan({ paymentTiming: "POSTPAID", billingMode: "PER_HOUR", rateMinor: 1500, roundingMinutes: 15, graceMinutes: 3 });
  it("grace period is free", () => expect(postpaidCharge(p, 170).totalMinor).toBe(0));
  it("rounds up to the next billing block", () => {
    expect(postpaidCharge(p, 61 * 60)).toEqual({ minutes: 75, totalMinor: 1875 });
    expect(postpaidCharge(p, 60 * 60)).toEqual({ minutes: 60, totalMinor: 1500 });
  });
});
