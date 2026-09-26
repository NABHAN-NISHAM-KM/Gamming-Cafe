// Phase 10 unit tests: bracket generation and settling (single & double
// elimination with byes, round robin, league, Swiss) — pure, no database.
import { describe, expect, it } from "vitest";
import { materialize, pairSwiss, placements, planBracket, report, seedOrder, settle, standings, type LiveMatch } from "../src/tournaments/brackets.js";

const teams = (n: number) => Array.from({ length: n }, (_, i) => `T${i + 1}`);
const build = (format: Parameters<typeof planBracket>[0], n: number) => {
  const live = materialize(planBracket(format, n), teams(n));
  settle(live);
  return live;
};
const get = (ms: LiveMatch[], key: string) => ms.find((m) => m.key === key)!;
/** Play every ready match, the better seed (lower number) winning. */
const playAll = (ms: LiveMatch[], pick: (m: LiveMatch) => string = (m) => (Number(m.teamA!.slice(1)) < Number(m.teamB!.slice(1)) ? m.teamA! : m.teamB!)) => {
  for (let i = 0; i < 200; i++) {
    const ready = ms.find((m) => m.status === "READY");
    if (!ready) return;
    report(ms, ready.key, pick(ready));
  }
};

describe("seeding", () => {
  it("top seeds meet last", () => {
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    expect(seedOrder(4)).toEqual([1, 4, 2, 3]);
  });
});

describe("single elimination", () => {
  it("8 teams: 7 matches in 3 rounds; the winner goes through to the right slot", () => {
    const ms = build("SINGLE_ELIMINATION", 8);
    expect(ms).toHaveLength(7);
    expect(get(ms, "W1-0")).toMatchObject({ teamA: "T1", teamB: "T8", status: "READY" });
    report(ms, "W1-0", "T8");
    expect(get(ms, "W2-0").teamA).toBe("T8");
    report(ms, "W1-1", "T4");
    expect(get(ms, "W2-0")).toMatchObject({ teamA: "T8", teamB: "T4", status: "READY" });
  });

  it("6 teams: the top two seeds get byes and are already in round 2", () => {
    const ms = build("SINGLE_ELIMINATION", 6);
    const byes = ms.filter((m) => m.status === "WALKOVER");
    expect(byes.map((m) => m.winner).sort()).toEqual(["T1", "T2"]);
    expect(get(ms, "W2-0").teamA).toBe("T1");
    expect(get(ms, "W2-1").teamA).toBe("T2");
  });

  it("placements: champion, finalist, then semifinal losers share 3rd", () => {
    const ms = build("SINGLE_ELIMINATION", 4);
    playAll(ms);
    const p = placements(ms, teams(4));
    expect(p.get("T1")).toBe(1);
    expect(p.get("T2")).toBe(2);
    expect(p.get("T3")).toBe(3);
    expect(p.get("T4")).toBe(3);
  });

  it("refuses results that don't fit", () => {
    const ms = build("SINGLE_ELIMINATION", 4);
    expect(() => report(ms, "W2-0", "T1")).toThrow(/aren't known/);
    expect(() => report(ms, "W1-0", "T2")).toThrow(/isn't playing/);
    report(ms, "W1-0", "T1");
    expect(() => report(ms, "W1-0", "T4")).toThrow(/already has a result/);
  });
});

describe("double elimination", () => {
  it("8 teams: 7 winners-bracket + 6 losers-bracket matches + grand final; losers drop down", () => {
    const ms = build("DOUBLE_ELIMINATION", 8);
    expect(ms.filter((m) => m.bracket === "WINNERS")).toHaveLength(7);
    expect(ms.filter((m) => m.bracket === "LOSERS")).toHaveLength(6);
    expect(ms.filter((m) => m.bracket === "GRAND_FINAL")).toHaveLength(1);
    report(ms, "W1-0", "T1"); // T8 drops
    report(ms, "W1-1", "T4"); // T5 drops
    expect(get(ms, "L1-0")).toMatchObject({ teamA: "T8", teamB: "T5", status: "READY" });
  });

  it("a team is only out after its second loss, and the grand final decides it", () => {
    const ms = build("DOUBLE_ELIMINATION", 4);
    playAll(ms);
    const gf = get(ms, "GF");
    expect(gf.status).toBe("COMPLETED");
    expect(gf.winner).toBe("T1");
    const p = placements(ms, teams(4));
    expect([p.get("T1"), p.get("T2"), p.get("T3"), p.get("T4")]).toEqual([1, 2, 3, 4]);
  });

  it("an upset: the losers-bracket champion can win the grand final", () => {
    const ms = build("DOUBLE_ELIMINATION", 4);
    // T4 loses in round 1, then wins every match after that.
    playAll(ms, (m) => (m.teamA === "T4" || m.teamB === "T4" ? (m.bracket === "WINNERS" && m.round === 1 ? (m.teamA === "T4" ? m.teamB! : m.teamA!) : "T4") : Number(m.teamA!.slice(1)) < Number(m.teamB!.slice(1)) ? m.teamA! : m.teamB!));
    expect(get(ms, "GF").winner).toBe("T4");
    expect(placements(ms, teams(4)).get("T4")).toBe(1);
  });

  it("byes cascade: with 5 teams the losers bracket walks over the empty slots and still finishes", () => {
    const ms = build("DOUBLE_ELIMINATION", 5);
    playAll(ms);
    expect(get(ms, "GF").status).toBe("COMPLETED");
    expect(ms.every((m) => m.status === "COMPLETED" || m.status === "WALKOVER")).toBe(true);
    const p = placements(ms, teams(5));
    expect(p.get("T1")).toBe(1);
    expect(new Set(teams(5).map((t) => p.has(t)))).toEqual(new Set([true]));
  });

  it("needs at least four teams", () => {
    expect(() => planBracket("DOUBLE_ELIMINATION", 3)).toThrow(/four/);
  });
});

describe("round robin & league", () => {
  it("everyone plays everyone once; an odd field rests one team per round", () => {
    const plan = planBracket("ROUND_ROBIN", 5);
    expect(plan).toHaveLength(10); // C(5,2)
    const pairs = new Set(plan.map((m) => [m.seedA, m.seedB].sort().join("-")));
    expect(pairs.size).toBe(10);
    expect(new Set(plan.map((m) => m.round)).size).toBe(5);
  });

  it("a league plays everyone twice, home and away", () => {
    const plan = planBracket("LEAGUE", 4);
    expect(plan).toHaveLength(12);
    expect(plan.filter((m) => m.seedA === 1 && m.seedB === 2).length + plan.filter((m) => m.seedA === 2 && m.seedB === 1).length).toBe(2);
  });

  it("table: 3 for a win, 1 for a draw, then score difference", () => {
    const t = standings(["A", "B", "C"], [
      { teamA: "A", teamB: "B", scoreA: 2, scoreB: 0, winner: "A" },
      { teamA: "B", teamB: "C", scoreA: 1, scoreB: 1, winner: null },
      { teamA: "C", teamB: "A", scoreA: 2, scoreB: 1, winner: "C" },
    ]);
    expect(t.map((s) => [s.team, s.points])).toEqual([["C", 4], ["A", 3], ["B", 1]]);
  });
});

describe("swiss", () => {
  it("round 1 is top half vs bottom half; an odd field gives the middle seed a bye", () => {
    const ms = build("SWISS", 5);
    expect(ms.filter((m) => m.status === "READY").map((m) => [m.teamA, m.teamB])).toEqual([["T1", "T4"], ["T2", "T5"]]);
    expect(ms.find((m) => m.status === "WALKOVER")).toMatchObject({ teamA: "T3", winner: "T3" });
  });

  it("later rounds pair equal scores and avoid rematches; the bye goes to someone who hasn't had one", () => {
    const table = standings(["A", "B", "C", "D", "E"], [
      { teamA: "A", teamB: "D", scoreA: 1, scoreB: 0, winner: "A" },
      { teamA: "B", teamB: "E", scoreA: 1, scoreB: 0, winner: "B" },
    ], ["C"]);
    const next = pairSwiss(table, [["A", "D"], ["B", "E"]]);
    expect(next.bye).not.toBe("C");
    const flat = next.pairs.flat();
    expect(new Set(flat).size).toBe(4);
    expect(next.pairs.some(([a, b]) => (a === "A" && b === "D") || (a === "D" && b === "A"))).toBe(false);
  });
});
