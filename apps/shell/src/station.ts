import { useEffect, useState } from "react";
import { bridge, type Art, type Peripheral, type PointerPreset, type Probe, type ShellAppItem, type ShellGame } from "./bridge";

export interface StationData {
  games: ShellGame[];
  apps: ShellAppItem[];
  presets: PointerPreset[];
  playing: { gameId: string; title: string } | null;
  probe: Probe | null;
  peripherals: Peripheral[];
  pointer: { mouseSpeed: number; enhancePointerPrecision: boolean } | null;
  /** Real icons and covers by game/app id (from the Windows host). */
  art: Record<string, Art>;
}

const empty: StationData = { games: [], apps: [], presets: [], playing: null, probe: null, peripherals: [], pointer: null, art: {} };
let current = empty;
const subs = new Set<(d: StationData) => void>();
const set = (patch: Partial<StationData>) => {
  current = { ...current, ...patch };
  subs.forEach((f) => f(current));
};

// One subscription for the whole app; screens read from it.
bridge.subscribe((m) => {
  switch (m.type) {
    case "library":
      return set({ games: m.games, apps: m.apps, presets: m.presets });
    case "playing":
      return set({ playing: m.gameId && m.title ? { gameId: m.gameId, title: m.title } : null });
    case "network":
      return set({ probe: m.probe });
    case "peripherals":
      return set({ peripherals: m.items });
    case "art":
      return set({ art: { ...current.art, ...Object.fromEntries(m.items.map((a) => [a.id, a])) } });
    case "pointer":
      return set({ pointer: { mouseSpeed: m.mouseSpeed, enhancePointerPrecision: m.enhancePointerPrecision } });
  }
});

export function useStation(): StationData {
  const [d, setD] = useState(current);
  useEffect(() => {
    subs.add(setD);
    setD(current);
    return () => void subs.delete(setD);
  }, []);
  return d;
}

/** Stable, pleasant gradient per title — the Shell ships no cover art. */
export function tileColors(title: string): [string, string] {
  let h = 0;
  for (const c of title) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const a = h % 360;
  return [`oklch(0.42 0.16 ${a})`, `oklch(0.22 0.09 ${(a + 50) % 360})`];
}

export const CATEGORY_LABEL: Record<string, string> = {
  FPS: "Shooters", MOBA: "MOBA", BATTLE_ROYALE: "Battle royale", SPORTS: "Sports", RACING: "Racing", COMPETITIVE: "Competitive",
  MULTIPLAYER: "Multiplayer", STORY: "Story", RPG: "RPG", STRATEGY: "Strategy", FIGHTING: "Fighting", CASUAL: "Casual", KIDS: "Kids",
  SIMULATION: "Simulation", VR: "VR",
};
