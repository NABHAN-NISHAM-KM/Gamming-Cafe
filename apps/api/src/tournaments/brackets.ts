/**
 * Tournament brackets — pure functions, no I/O (unit-tested in
 * test/brackets.test.ts).
 *
 * A bracket is a list of matches. Each match slot (A/B) is filled either by a
 * seed (first round) or by a *feeder*: the winner or the loser of another
 * match. `settle()` recomputes every slot from its feeders until nothing
 * changes, so byes cascade correctly through both brackets of a double
 * elimination (a bye produces no loser, so the losers-bracket opponent
 * advances on a walkover).
 */

export type Format = "SINGLE_ELIMINATION" | "DOUBLE_ELIMINATION" | "ROUND_ROBIN" | "LEAGUE" | "SWISS";
export type Side = "WINNERS" | "LOSERS" | "GRAND_FINAL" | "GROUP" | "LEAGUE";
export type Slot = "A" | "B";

export interface PlanMatch {
  key: string; // "W1-0", "L2-1", "GF", "R3-2"
  bracket: Side;
  round: number;
  position: number;
  /** Seed numbers (1-based) for first-round slots; null = filled by a feeder (or a bye). */
  seedA: number | null;
  seedB: number | null;
  next: { key: string; slot: Slot } | null;
  loserNext: { key: string; slot: Slot } | null;
}

export class BracketError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

const nextPow2 = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(2, n)));

/**
 * Standard seeding order so the top seeds meet last: for 8 → 1,8,4,5,2,7,3,6.
 * Adjacent pairs are first-round opponents.
 */
export function seedOrder(size: number): number[] {
  let order = [1, 2];
  while (order.length < size) {
    const n = order.length * 2 + 1;
    order = order.flatMap((s) => [s, n - s]);
  }
  return order;
}

// ── generation ──────────────────────────────────────────────────────────────

export function planBracket(format: Format, teams: number, opts: { swissRounds?: number } = {}): PlanMatch[] {
  if (teams < 2) throw new BracketError("too_few_teams", "At least two teams are needed.");
  switch (format) {
    case "SINGLE_ELIMINATION":
      return single(teams);
    case "DOUBLE_ELIMINATION":
      if (teams < 4) throw new BracketError("too_few_teams", "Double elimination needs at least four teams.");
      return double(teams);
    case "ROUND_ROBIN":
      return roundRobin(teams, 1);
    case "LEAGUE":
      return roundRobin(teams, 2);
    case "SWISS":
      return swissFirstRound(teams, opts.swissRounds ?? swissRoundsFor(teams));
  }
}

function single(teams: number): PlanMatch[] {
  const size = nextPow2(teams);
  const rounds = Math.log2(size);
  const order = seedOrder(size);
  const out: PlanMatch[] = [];
  for (let r = 1; r <= rounds; r++) {
    const count = size / 2 ** r;
    for (let p = 0; p < count; p++) {
      out.push({
        key: `W${r}-${p}`, bracket: "WINNERS", round: r, position: p,
        seedA: r === 1 ? orNull(order[p * 2]!, teams) : null,
        seedB: r === 1 ? orNull(order[p * 2 + 1]!, teams) : null,
        next: r < rounds ? { key: `W${r + 1}-${Math.floor(p / 2)}`, slot: p % 2 === 0 ? "A" : "B" } : null,
        loserNext: null,
      });
    }
  }
  return out;
}

const orNull = (seed: number, teams: number) => (seed <= teams ? seed : null);

/**
 * Double elimination: the winners bracket is a single elimination; its
 * losers drop into a losers bracket that alternates "minor" rounds (losers
 * bracket survivors play each other) and "major" rounds (they meet the next
 * batch of winners-bracket losers). The winners-bracket champion meets the
 * losers-bracket champion in the grand final.
 */
function double(teams: number): PlanMatch[] {
  const wb = single(teams);
  const size = nextPow2(teams);
  const k = Math.log2(size);
  const byKey = new Map(wb.map((m) => [m.key, m]));
  const lb: PlanMatch[] = [];
  // LB rounds: 1 .. 2(k-1). Round 1: losers of WB R1 paired. Even rounds (major): LB winners vs WB R(j+1) losers.
  const lbRounds = 2 * (k - 1);
  const lbCount = (r: number) => size / 2 ** (Math.floor((r + 1) / 2) + 1);
  for (let r = 1; r <= lbRounds; r++) {
    for (let p = 0; p < lbCount(r); p++) {
      let next: PlanMatch["next"];
      if (r === lbRounds) next = { key: "GF", slot: "B" };
      else if (r % 2 === 1) next = { key: `L${r + 1}-${p}`, slot: "A" }; // minor → major (same position)
      else next = { key: `L${r + 1}-${Math.floor(p / 2)}`, slot: p % 2 === 0 ? "A" : "B" }; // major → next minor (halves)
      lb.push({ key: `L${r}-${p}`, bracket: "LOSERS", round: r, position: p, seedA: null, seedB: null, next, loserNext: null });
    }
  }
  // Losers of WB round 1 → LB round 1 (pairs); losers of WB round j (j ≥ 2) → LB round 2(j-1), slot B.
  for (const m of wb) {
    if (m.round === 1) m.loserNext = { key: `L1-${Math.floor(m.position / 2)}`, slot: m.position % 2 === 0 ? "A" : "B" };
    else {
      // Reverse the order of each drop-down round so teams don't meet again straight away.
      const count = lbCount(2 * (m.round - 1));
      m.loserNext = { key: `L${2 * (m.round - 1)}-${count - 1 - m.position}`, slot: "B" };
    }
  }
  const wbFinal = byKey.get(`W${k}-0`)!;
  wbFinal.next = { key: "GF", slot: "A" };
  const gf: PlanMatch = { key: "GF", bracket: "GRAND_FINAL", round: 1, position: 0, seedA: null, seedB: null, next: null, loserNext: null };
  return [...wb, ...lb, gf];
}

/** Circle method; `legs` = 2 plays everyone twice (league). An odd field gets a rest each round. */
function roundRobin(teams: number, legs: number): PlanMatch[] {
  const n = teams % 2 === 0 ? teams : teams + 1; // n-th = "rest"
  const ids = Array.from({ length: n }, (_, i) => i + 1);
  const out: PlanMatch[] = [];
  const perLeg = n - 1;
  for (let leg = 0; leg < legs; leg++) {
    let rot = [...ids];
    for (let r = 0; r < perLeg; r++) {
      let p = 0;
      for (let i = 0; i < n / 2; i++) {
        let a = rot[i]!;
        let b = rot[n - 1 - i]!;
        if (a > teams || b > teams) continue; // the resting team this round
        if (leg % 2 === 1) [a, b] = [b, a];
        const round = leg * perLeg + r + 1;
        out.push({ key: `R${round}-${p}`, bracket: legs === 2 ? "LEAGUE" : "GROUP", round, position: p++, seedA: a, seedB: b, next: null, loserNext: null });
      }
      rot = [rot[0]!, rot[n - 1]!, ...rot.slice(1, n - 1)];
    }
  }
  return out;
}

export const swissRoundsFor = (teams: number) => Math.max(1, Math.ceil(Math.log2(teams)));

/** Swiss round 1: top half vs bottom half by seed; later rounds come from `pairSwiss`. */
function swissFirstRound(teams: number, _rounds: number): PlanMatch[] {
  const half = Math.floor(teams / 2);
  const odd = teams % 2;
  const out: PlanMatch[] = Array.from({ length: half }, (_, p) => ({ key: `R1-${p}`, bracket: "GROUP" as const, round: 1, position: p, seedA: p + 1 + (p >= half ? odd : 0), seedB: p + 1 + half + odd, next: null, loserNext: null }));
  // Odd field: the middle seed sits out round 1 (a bye counts as a win).
  if (odd) out.push({ key: `R1-${half}`, bracket: "GROUP", round: 1, position: half, seedA: half + 1, seedB: null, next: null, loserNext: null });
  return out;
}

/** Turn a plan into live matches for the given teams (index = seed − 1). */
export function materialize(plan: PlanMatch[], teamIds: string[]): LiveMatch[] {
  return plan.map((m) => {
    const firstRound = (m.bracket === "WINNERS" && m.round === 1) || m.bracket === "GROUP" || m.bracket === "LEAGUE";
    return {
      key: m.key, bracket: m.bracket, round: m.round, position: m.position,
      teamA: m.seedA ? teamIds[m.seedA - 1] ?? null : null,
      teamB: m.seedB ? teamIds[m.seedB - 1] ?? null : null,
      winner: null, status: "PENDING" as MatchStatus, next: m.next, loserNext: m.loserNext,
      byeA: firstRound && !m.seedA, byeB: firstRound && !m.seedB,
    };
  });
}

// ── settling results ────────────────────────────────────────────────────────

export type MatchStatus = "PENDING" | "READY" | "COMPLETED" | "WALKOVER" | "CANCELLED" | "LIVE" | "SCHEDULED" | "AWAITING_CONFIRMATION" | "DISPUTED";

/** Live state of a match (what the database holds). Team ids are opaque strings. */
export interface LiveMatch {
  key: string;
  bracket: Side;
  round: number;
  position: number;
  teamA: string | null;
  teamB: string | null;
  winner: string | null;
  status: MatchStatus;
  next: { key: string; slot: Slot } | null;
  loserNext: { key: string; slot: Slot } | null;
  /** First-round seed slots that stay empty (a bye). */
  byeA?: boolean;
  byeB?: boolean;
}

const done = (m: LiveMatch) => m.status === "COMPLETED" || m.status === "WALKOVER";

/**
 * Recompute slots from feeders and auto-resolve byes until nothing changes.
 * Returns the matches that changed. Never touches a match that was played.
 */
export function settle(matches: LiveMatch[]): LiveMatch[] {
  const byKey = new Map(matches.map((m) => [m.key, m]));
  const feeders = new Map<string, Array<{ from: LiveMatch; kind: "WIN" | "LOSE"; slot: Slot }>>();
  for (const m of matches) {
    if (m.next) feeders.set(m.next.key, [...(feeders.get(m.next.key) ?? []), { from: m, kind: "WIN", slot: m.next.slot }]);
    if (m.loserNext) feeders.set(m.loserNext.key, [...(feeders.get(m.loserNext.key) ?? []), { from: m, kind: "LOSE", slot: m.loserNext.slot }]);
  }
  const changed = new Set<string>();
  // A slot is known when its feeder is decided: the team it produces, or EMPTY.
  type Known = { team: string | null } | undefined;
  const slotOf = (m: LiveMatch, slot: Slot): Known => {
    const f = (feeders.get(m.key) ?? []).find((x) => x.slot === slot);
    if (!f) {
      const bye = slot === "A" ? m.byeA : m.byeB;
      const team = slot === "A" ? m.teamA : m.teamB;
      return team ? { team } : bye ? { team: null } : undefined;
    }
    if (!done(f.from)) return undefined;
    if (f.kind === "WIN") return { team: f.from.winner };
    const loser = f.from.winner === f.from.teamA ? f.from.teamB : f.from.teamA;
    return { team: f.from.winner ? loser : null };
  };
  for (let guard = 0; guard < matches.length * 4 + 10; guard++) {
    let moved = false;
    for (const m of matches) {
      if (done(m) && m.status === "COMPLETED") continue; // played: fixed
      const a = slotOf(m, "A");
      const b = slotOf(m, "B");
      const ta = a?.team ?? null;
      const tb = b?.team ?? null;
      if ((a && m.teamA !== ta) || (b && m.teamB !== tb)) {
        if (a) m.teamA = ta;
        if (b) m.teamB = tb;
        changed.add(m.key);
        moved = true;
      }
      if (a && b && m.status !== "WALKOVER" && (ta === null || tb === null)) {
        // One side (or both) will never come: a walkover for whoever is there.
        m.winner = ta ?? tb;
        m.status = "WALKOVER";
        changed.add(m.key);
        moved = true;
      } else if (a && b && ta && tb && m.status === "PENDING") {
        m.status = "READY";
        changed.add(m.key);
        moved = true;
      }
    }
    if (!moved) break;
  }
  void byKey;
  return matches.filter((m) => changed.has(m.key));
}

/** Apply a result, then settle. Returns changed matches (including this one). */
export function report(matches: LiveMatch[], key: string, winner: string): LiveMatch[] {
  const m = matches.find((x) => x.key === key);
  if (!m) throw new BracketError("match_not_found", "No such match.");
  if (m.status === "COMPLETED" || m.status === "WALKOVER") throw new BracketError("match_decided", "That match already has a result.");
  if (!m.teamA || !m.teamB) throw new BracketError("match_not_ready", "Both teams aren't known yet.");
  if (winner !== m.teamA && winner !== m.teamB) throw new BracketError("not_in_match", "That team isn't playing this match.");
  // A decided match whose later matches are already played can't be changed — that's what "match_decided" protects.
  m.winner = winner;
  m.status = "COMPLETED";
  const rest = settle(matches);
  return [m, ...rest.filter((x) => x.key !== key)];
}

/** Elimination brackets: the champion once the final is decided (grand final in double elimination). */
export function champion(matches: LiveMatch[]): string | null {
  const final = matches.find((m) => m.bracket === "GRAND_FINAL") ?? matches.filter((m) => m.bracket === "WINNERS").sort((a, b) => b.round - a.round)[0];
  return final && done(final) ? final.winner : null;
}

/**
 * Final placements for elimination brackets: 1st the champion, 2nd the
 * finalist, then by how late each team was knocked out (ties share a place).
 */
export function placements(matches: LiveMatch[], teams: string[]): Map<string, number> {
  const out = new Map<string, number>();
  const champ = champion(matches);
  if (!champ) return out;
  // Elimination "depth": the last match each team lost (by bracket order).
  const order = (m: LiveMatch) => (m.bracket === "GRAND_FINAL" ? 10_000 : m.bracket === "LOSERS" ? 1_000 + m.round * 2 : m.round * 2 + 1);
  const lostAt = new Map<string, number>();
  for (const m of matches) {
    if (m.status !== "COMPLETED" || !m.winner) continue;
    const loser = m.winner === m.teamA ? m.teamB : m.teamA;
    if (!loser) continue;
    const isDouble = matches.some((x) => x.bracket === "LOSERS");
    // In double elimination the first (winners-bracket) loss isn't elimination.
    if (isDouble && m.bracket === "WINNERS") continue;
    lostAt.set(loser, Math.max(lostAt.get(loser) ?? 0, order(m)));
  }
  out.set(champ, 1);
  const rest = teams.filter((t) => t !== champ).sort((a, b) => (lostAt.get(b) ?? -1) - (lostAt.get(a) ?? -1));
  let place = 2;
  for (let i = 0; i < rest.length; i++) {
    if (i > 0 && (lostAt.get(rest[i]!) ?? -1) !== (lostAt.get(rest[i - 1]!) ?? -1)) place = i + 2;
    out.set(rest[i]!, place);
  }
  return out;
}

// ── league tables & Swiss ───────────────────────────────────────────────────

export interface Played {
  teamA: string;
  teamB: string;
  scoreA: number;
  scoreB: number;
  winner: string | null; // null = draw
}

export interface Standing {
  team: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  scoreFor: number;
  scoreAgainst: number;
  byes: number;
}

/** 3 points a win, 1 a draw; ties broken by score difference, then score for. */
export function standings(teams: string[], results: Played[], byes: string[] = []): Standing[] {
  const s = new Map(teams.map((t) => [t, { team: t, played: 0, wins: 0, draws: 0, losses: 0, points: 0, scoreFor: 0, scoreAgainst: 0, byes: 0 }]));
  for (const r of results) {
    const a = s.get(r.teamA);
    const b = s.get(r.teamB);
    if (!a || !b) continue;
    a.played++;
    b.played++;
    a.scoreFor += r.scoreA;
    a.scoreAgainst += r.scoreB;
    b.scoreFor += r.scoreB;
    b.scoreAgainst += r.scoreA;
    if (!r.winner) {
      a.draws++;
      b.draws++;
      a.points += 1;
      b.points += 1;
    } else if (r.winner === r.teamA) {
      a.wins++;
      b.losses++;
      a.points += 3;
    } else {
      b.wins++;
      a.losses++;
      b.points += 3;
    }
  }
  for (const t of byes) {
    const x = s.get(t);
    if (x) {
      x.byes++;
      x.points += 3; // a Swiss bye counts as a win
      x.wins++;
    }
  }
  return [...s.values()].sort((x, y) => y.points - x.points || y.scoreFor - y.scoreAgainst - (x.scoreFor - x.scoreAgainst) || y.scoreFor - x.scoreFor || x.team.localeCompare(y.team));
}

/**
 * Next Swiss round: pair teams with the same (or nearest) points, never a
 * rematch if it can be avoided; an odd field gives a bye to the lowest-ranked
 * team that hasn't had one.
 */
export function pairSwiss(table: Standing[], history: Array<[string, string]>): { pairs: Array<[string, string]>; bye: string | null } {
  const met = new Set(history.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]));
  const pool = [...table];
  let bye: string | null = null;
  if (pool.length % 2 === 1) {
    const idx = [...pool].reverse().findIndex((s) => s.byes === 0);
    const at = idx === -1 ? pool.length - 1 : pool.length - 1 - idx;
    bye = pool[at]!.team;
    pool.splice(at, 1);
  }
  const pairs: Array<[string, string]> = [];
  const solve = (left: Standing[]): boolean => {
    if (!left.length) return true;
    const [first, ...others] = left;
    for (let i = 0; i < others.length; i++) {
      if (met.has(`${first!.team}|${others[i]!.team}`)) continue;
      pairs.push([first!.team, others[i]!.team]);
      if (solve([...others.slice(0, i), ...others.slice(i + 1)])) return true;
      pairs.pop();
    }
    return false;
  };
  if (!solve(pool)) {
    // Everyone has met everyone they could: allow rematches, nearest first.
    pairs.length = 0;
    for (let i = 0; i + 1 < pool.length; i += 2) pairs.push([pool[i]!.team, pool[i + 1]!.team]);
  }
  return { pairs, bye };
}
