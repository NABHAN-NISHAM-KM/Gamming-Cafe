import { describe, expect, it } from "vitest";
import { resolveFeatures } from "../src/features.js";

describe("resolveFeatures", () => {
  it("uses catalog defaults when nothing is configured", () => {
    const r = resolveFeatures([], []);
    expect(r.enabled.has("PC_GAMING")).toBe(true);
    expect(r.enabled.has("VR_SIMULATOR")).toBe(false);
  });

  it("plan enables a module, org override disables it", () => {
    const plan = [{ featureKey: "RESTAURANT", enabled: true }, { featureKey: "VR_SIMULATOR", enabled: false }];
    expect(resolveFeatures(plan, []).enabled.has("RESTAURANT")).toBe(true);
    expect(resolveFeatures(plan, [{ featureKey: "RESTAURANT", enabled: false }]).enabled.has("RESTAURANT")).toBe(false);
    expect(resolveFeatures(plan, [{ featureKey: "VR_SIMULATOR", enabled: true }]).enabled.has("VR_SIMULATOR")).toBe(true);
  });

  it("resolves device/branch limits with org override precedence", () => {
    const r = resolveFeatures([{ featureKey: "MAX_DEVICES", enabled: true, limitValue: 50 }], [{ featureKey: "MAX_DEVICES", enabled: true, limitValue: 80 }]);
    expect(r.limits.MAX_DEVICES).toBe(80);
  });

  it("ignores unknown keys", () => {
    expect([...resolveFeatures([{ featureKey: "NOPE", enabled: true }], []).enabled]).not.toContain("NOPE");
  });
});
