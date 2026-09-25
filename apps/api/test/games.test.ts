import { describe, expect, it } from "vitest";
import { launchSpec } from "../src/games/station-config.service.js";
import { networkHealth } from "../src/stations/station-reports.service.js";

const game = (o: Partial<Parameters<typeof launchSpec>[0]>) => ({ launcherGameId: null, executablePath: null, arguments: null, workingDirectory: null, launcher: null, ...o });

describe("launchSpec", () => {
  it("Steam and Epic games launch through their launcher by store id", () => {
    expect(launchSpec(game({ launcher: { key: "STEAM" }, launcherGameId: "730" }))).toEqual({ kind: "STEAM", appId: "730" });
    expect(launchSpec(game({ launcher: { key: "EPIC" }, launcherGameId: "Fortnite" }))).toEqual({ kind: "EPIC", appName: "Fortnite" });
  });
  it("never builds a launcher link from a malformed id — falls back to the exe, or nothing", () => {
    expect(launchSpec(game({ launcher: { key: "STEAM" }, launcherGameId: "730; calc" }))).toBeNull();
    expect(launchSpec(game({ launcher: { key: "EPIC" }, launcherGameId: "a/../b" }))).toBeNull();
    expect(launchSpec(game({ launcher: { key: "STEAM" }, launcherGameId: "x y", executablePath: "C:\\G\\g.exe" }))).toMatchObject({ kind: "PATH", executablePath: "C:\\G\\g.exe" });
  });
  it("other launchers use the executable path", () => {
    expect(launchSpec(game({ launcher: { key: "RIOT" }, executablePath: "C:\\Riot Games\\Riot Client\\RiotClientServices.exe", arguments: "--launch-product=valorant" }))).toEqual({
      kind: "PATH",
      executablePath: "C:\\Riot Games\\Riot Client\\RiotClientServices.exe",
      arguments: "--launch-product=valorant",
      workingDirectory: null,
    });
  });
});

describe("networkHealth", () => {
  const t = (host: string, pingMs: number | null, lossPct = 0) => ({ name: host, host, pingMs, lossPct });
  it("ignores the router; judges the internet targets", () => {
    expect(networkHealth({ targets: [t("gateway", null, 100), t("1.1.1.1", 5)] }).level).toBe("OK");
    expect(networkHealth({ targets: [t("gateway", 1), t("1.1.1.1", null, 100), t("8.8.8.8", null, 100)] })).toEqual({ level: "CRITICAL", title: "Internet unreachable" });
  });
  it("warns on loss or latency", () => {
    expect(networkHealth({ targets: [t("1.1.1.1", 20, 25)] })).toEqual({ level: "WARNING", title: "Packet loss 25%" });
    expect(networkHealth({ targets: [t("1.1.1.1", 180), t("8.8.8.8", 210)] })).toEqual({ level: "WARNING", title: "High latency 180 ms" });
    expect(networkHealth({ targets: [t("1.1.1.1", 180), t("8.8.8.8", 12)] }).level).toBe("OK"); // one fast route is enough
  });
});
