"use client";

import { useMemo, useState } from "react";
import { Ban, CheckCircle2, Crown, Flag, Play, Plus, Trophy, UserPlus, Users } from "lucide-react";
import { api } from "@/lib/client/api";
import { useBranch } from "@/lib/client/branch";
import { useAction, useApi } from "@/lib/client/hooks";
import { useCan } from "@/lib/client/me";
import { idem } from "@/lib/client/sessions";
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Table, cx } from "@/components/ui";
import { CustomerPicker, type PickedCustomer } from "@/components/pos";

interface Row { id: string; name: string; status: string; format: string; game: string | null; branch: string; startsAt: string; teamSize: number; maxTeams: number; entered: number; entryFee: string; prizePool: string; currency: string }
interface MatchV { id: string; bracket: string; round: number; position: number; status: string; teamA: { id: string; name: string } | null; teamB: { id: string; name: string } | null; scoreA: number | null; scoreB: number | null; winnerTeamId: string | null; byeA: boolean; byeB: boolean }
interface TeamV { id: string; name: string; seed: number | null; status: string; finalPlacement: number | null; paid: boolean; captain: { id: string; displayName: string } | null; players: Array<{ id: string; displayName: string; username: string; checkedIn: boolean }> }
interface Detail {
  id: string; name: string; status: string; format: string; game: string | null; teamSize: number; maxTeams: number; minTeams: number; entryFee: string; prizePool: string; currency: string;
  prizeDistribution: Array<{ place: number; amount: number }>; startsAt: string; entered: number; teams: TeamV[]; matches: MatchV[];
  standings: Array<{ team: string; name: string; played: number; wins: number; draws: number; losses: number; points: number; scoreFor: number; scoreAgainst: number }> | null;
}

const FORMAT: Record<string, string> = { SINGLE_ELIMINATION: "Single elimination", DOUBLE_ELIMINATION: "Double elimination", ROUND_ROBIN: "Round robin", LEAGUE: "League (home & away)", SWISS: "Swiss" };
const STATUS_TONE: Record<string, "neutral" | "accent" | "warn" | "ok" | "danger"> = { DRAFT: "neutral", REGISTRATION_OPEN: "accent", REGISTRATION_CLOSED: "warn", CHECK_IN: "warn", IN_PROGRESS: "ok", COMPLETED: "neutral", CANCELLED: "danger" };
const pretty = (s: string) => s.toLowerCase().replace(/_/g, " ");

export default function TournamentsPage() {
  const can = useCan();
  const list = useApi<Row[]>("/tournaments");
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  return (
    <div className="space-y-5">
      <PageHeader
        title="Tournaments"
        subtitle="Run brackets and leagues: registration with entry fees, check-in, seeding, live results, and prizes paid to winners' wallets."
        actions={can("tournament.manage") && <Button variant="primary" onClick={() => setCreating(true)}><Plus className="size-4" /> Tournament</Button>}
      />
      <Card>
        {!list.data ? <Spinner /> : list.data.length === 0 ? <Empty icon={<Trophy className="size-8" />} title="No tournaments yet" /> : (
          <Table head={["Tournament", "Format", "Starts", "Teams", "Entry", "Prize pool", "Status"]}>
            {list.data.map((t) => (
              <tr key={t.id} className="cursor-pointer border-t border-line hover:bg-panel-2" onClick={() => setOpen(t.id)}>
                <td className="px-4 py-2"><p className="font-medium">{t.name}</p><p className="text-xs text-ink-3">{t.game ?? "—"} · {t.branch}{t.teamSize > 1 ? ` · ${t.teamSize}v${t.teamSize}` : " · 1v1"}</p></td>
                <td className="px-4 py-2 text-ink-2">{FORMAT[t.format]}</td>
                <td className="px-4 py-2 text-ink-2">{new Date(t.startsAt).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                <td className="px-4 py-2 tabular-nums">{t.entered}/{t.maxTeams}</td>
                <td className="px-4 py-2 tabular-nums">{Number(t.entryFee) > 0 ? `${t.currency} ${t.entryFee}` : "Free"}</td>
                <td className="px-4 py-2 tabular-nums">{Number(t.prizePool) > 0 ? `${t.currency} ${t.prizePool}` : "—"}</td>
                <td className="px-4 py-2"><Badge tone={STATUS_TONE[t.status] ?? "neutral"}>{pretty(t.status)}</Badge></td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Modal open={creating} onClose={() => setCreating(false)} title="New tournament" wide>
        {creating && <NewTournament onDone={(id) => { setCreating(false); void list.reload(); setOpen(id); }} />}
      </Modal>
      <Modal open={!!open} onClose={() => { setOpen(null); void list.reload(); }} title="Tournament" wide>
        {open && <TournamentView id={open} />}
      </Modal>
    </div>
  );
}

function NewTournament({ onDone }: { onDone: (id: string) => void }) {
  const { branches, branchId } = useBranch();
  const games = useApi<{ games: Array<{ id: string; title: string }> }>("/games");
  const [f, setF] = useState({ name: "", branchId: "", gameId: "", format: "SINGLE_ELIMINATION", teamSize: "1", maxTeams: "8", minTeams: "4", entryFee: "0", prizePool: "0", prizes: "", startsAt: "", isPublic: true, rules: "" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = useAction(async () => {
    const prizeDistribution = f.prizes.split(",").map((s) => s.trim()).filter(Boolean).map((a, i) => ({ place: i + 1, amount: Number(a) }));
    const t = await api<{ id: string }>("/tournaments", {
      method: "POST",
      body: {
        name: f.name.trim(), branchId: f.branchId || branchId, gameId: f.gameId || null, format: f.format, teamSize: Number(f.teamSize), maxTeams: Number(f.maxTeams), minTeams: Number(f.minTeams),
        entryFee: f.entryFee || "0", prizePool: f.prizePool || "0", prizeDistribution, startsAt: new Date(f.startsAt).toISOString(), isPublic: f.isPublic, rules: f.rules || null,
      },
    });
    onDone(t.id);
  });
  return (
    <form className="grid gap-3 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); void save.run(); }}>
      <Field label="Name" className="sm:col-span-2"><Input value={f.name} onChange={set("name")} required minLength={3} placeholder="FIFA Friday 1v1" /></Field>
      <Field label="Branch"><Select value={f.branchId || branchId || ""} onChange={set("branchId")}>{branches.data?.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}</Select></Field>
      <Field label="Game"><Select value={f.gameId} onChange={set("gameId")}><option value="">Other</option>{(games.data?.games ?? []).map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}</Select></Field>
      <Field label="Format" className="sm:col-span-2"><Select value={f.format} onChange={set("format")}>{Object.entries(FORMAT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
      <Field label="Players per team"><Input type="number" min={1} max={10} value={f.teamSize} onChange={set("teamSize")} /></Field>
      <Field label="Starts"><Input type="datetime-local" value={f.startsAt} onChange={set("startsAt")} required /></Field>
      <Field label="Most teams"><Input type="number" min={2} max={256} value={f.maxTeams} onChange={set("maxTeams")} /></Field>
      <Field label="Fewest teams"><Input type="number" min={2} max={256} value={f.minTeams} onChange={set("minTeams")} /></Field>
      <Field label="Entry fee (per team)"><Input inputMode="decimal" value={f.entryFee} onChange={set("entryFee")} /></Field>
      <Field label="Prize pool"><Input inputMode="decimal" value={f.prizePool} onChange={set("prizePool")} /></Field>
      <Field label="Prizes by place" hint="e.g. 120, 60, 20 — paid to the captains' wallets" className="sm:col-span-2"><Input value={f.prizes} onChange={set("prizes")} placeholder="120, 60, 20" /></Field>
      <label className="flex items-center gap-2 self-end pb-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.isPublic} onChange={(e) => setF({ ...f, isPublic: e.target.checked })} /> Listed in the customer app</label>
      <Field label="Rules" className="sm:col-span-4"><Input value={f.rules} onChange={set("rules")} maxLength={5000} placeholder="Settings, match length, check-in time…" /></Field>
      <div className="sm:col-span-4"><ErrorNote>{save.error}</ErrorNote></div>
      <div className="flex justify-end sm:col-span-4"><Button type="submit" variant="primary" pending={save.pending}>Create (as a draft)</Button></div>
    </form>
  );
}

function TournamentView({ id }: { id: string }) {
  const can = useCan();
  const t = useApi<Detail>(`/tournaments/${id}`);
  const [adding, setAdding] = useState(false);
  const [scoring, setScoring] = useState<MatchV | null>(null);
  const act = useAction(async (path: string, body?: unknown) => {
    const r = await api<Detail | Record<string, unknown>>(path, { method: "POST", body: body ?? {} });
    if (r && "matches" in r) t.setData(r as Detail);
    else await t.reload();
  });
  if (!t.data) return t.error ? <ErrorNote>{t.error.message}</ErrorNote> : <Spinner />;
  const d = t.data;
  const manage = can("tournament.manage");
  const live = d.teams.filter((x) => !["WITHDRAWN", "DISQUALIFIED"].includes(x.status));
  return (
    <div className="grid gap-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg font-semibold">{d.name}</span>
        <Badge tone={STATUS_TONE[d.status] ?? "neutral"}>{pretty(d.status)}</Badge>
        <span className="text-ink-3">{FORMAT[d.format]} · {d.game ?? "—"} · {live.length}/{d.maxTeams} teams · entry {Number(d.entryFee) > 0 ? `${d.currency} ${d.entryFee}` : "free"}{Number(d.prizePool) > 0 ? ` · prizes ${d.prizeDistribution.map((p) => `#${p.place} ${p.amount}`).join(", ")}` : ""}</span>
      </div>
      <ErrorNote>{act.error}</ErrorNote>
      {manage && (
        <div className="flex flex-wrap gap-2">
          {d.status === "DRAFT" && <Button variant="primary" pending={act.pending} onClick={() => void act.run(`/tournaments/${id}/status`, { status: "REGISTRATION_OPEN" })}><Flag className="size-4" /> Open registration</Button>}
          {["REGISTRATION_OPEN", "REGISTRATION_CLOSED", "CHECK_IN"].includes(d.status) && (
            <>
              {d.status === "REGISTRATION_OPEN" && <Button onClick={() => setAdding(true)}><UserPlus className="size-4" /> Register a team</Button>}
              {d.status !== "CHECK_IN" && <Button variant="ghost" pending={act.pending} onClick={() => void act.run(`/tournaments/${id}/status`, { status: "CHECK_IN" })}>Start check-in</Button>}
              <Button variant="primary" pending={act.pending} disabled={live.length < d.minTeams} onClick={() => confirm(`Seed ${live.length} teams and start?`) && void act.run(`/tournaments/${id}/start`)}><Play className="size-4" /> Start ({live.length}/{d.minTeams}+)</Button>
            </>
          )}
          {!["COMPLETED", "CANCELLED"].includes(d.status) && (
            <Button variant="danger" pending={act.pending} onClick={() => { const r = prompt("Why cancel? Paid entries are refunded to wallets."); if (r) void act.run(`/tournaments/${id}/status`, { status: "CANCELLED", reason: r }); }}><Ban className="size-4" /> Cancel</Button>
          )}
        </div>
      )}

      {d.matches.length > 0 && <Bracket d={d} onScore={can("tournament.score") && d.status === "IN_PROGRESS" ? setScoring : undefined} />}
      {d.standings && d.matches.length > 0 && (
        <Table head={["#", "Team", "P", "W", "D", "L", "Score", "Pts"]}>
          {d.standings.map((s, i) => (
            <tr key={s.team} className="border-t border-line">
              <td className="px-3 py-1.5 text-ink-3">{i + 1}</td>
              <td className="px-3 py-1.5 font-medium">{s.name}</td>
              <td className="px-3 py-1.5 tabular-nums">{s.played}</td><td className="px-3 py-1.5 tabular-nums">{s.wins}</td><td className="px-3 py-1.5 tabular-nums">{s.draws}</td><td className="px-3 py-1.5 tabular-nums">{s.losses}</td>
              <td className="px-3 py-1.5 tabular-nums text-ink-2">{s.scoreFor}–{s.scoreAgainst}</td><td className="px-3 py-1.5 font-semibold tabular-nums">{s.points}</td>
            </tr>
          ))}
        </Table>
      )}

      <div>
        <p className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wider text-ink-3"><Users className="size-3.5" /> Teams</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {d.teams.map((team) => (
            <div key={team.id} className={cx("flex items-center gap-2 rounded-lg border border-line px-3 py-2", ["WITHDRAWN", "DISQUALIFIED"].includes(team.status) && "opacity-50")}>
              {team.finalPlacement === 1 ? <Crown className="size-4 text-reserved" /> : team.seed ? <span className="w-5 text-xs text-ink-3">#{team.seed}</span> : null}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{team.name}{team.finalPlacement ? <span className="ml-1 text-xs text-ink-3">· {ordinal(team.finalPlacement)}</span> : null}</p>
                <p className="truncate text-xs text-ink-3">{team.players.map((p) => `${p.displayName}${p.checkedIn ? " ✓" : ""}`).join(", ")}</p>
              </div>
              <Badge tone={team.status === "CHECKED_IN" ? "ok" : team.status === "WINNER" ? "accent" : "neutral"}>{pretty(team.status)}</Badge>
              {manage && ["REGISTRATION_OPEN", "REGISTRATION_CLOSED", "CHECK_IN"].includes(d.status) && team.status === "CONFIRMED" && <Button size="sm" variant="ghost" pending={act.pending} onClick={() => void act.run(`/teams/${team.id}/check-in`)}><CheckCircle2 className="size-3.5" /></Button>}
              {manage && ["REGISTRATION_OPEN", "REGISTRATION_CLOSED", "CHECK_IN"].includes(d.status) && ["CONFIRMED", "CHECKED_IN"].includes(team.status) && (
                <Button size="sm" variant="ghost" pending={act.pending} onClick={() => { const r = prompt(`Withdraw ${team.name}?${team.paid ? " The fee goes back to the captain's wallet." : ""} Reason:`); if (r && r.trim().length >= 3) void act.run(`/teams/${team.id}/withdraw`, { reason: r.trim() }); }}><Ban className="size-3.5" /></Button>
              )}
            </div>
          ))}
          {d.teams.length === 0 && <p className="text-ink-3">No teams yet.</p>}
        </div>
      </div>

      <Modal open={adding} onClose={() => setAdding(false)} title="Register a team">
        {adding && <Register t={d} onDone={() => { setAdding(false); void t.reload(); }} />}
      </Modal>
      <Modal open={!!scoring} onClose={() => setScoring(null)} title="Result">
        {scoring && <Score m={scoring} knockout={!["GROUP", "LEAGUE"].includes(scoring.bracket)} onDone={(r) => { setScoring(null); t.setData(r); }} />}
      </Modal>
    </div>
  );
}

const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;

function Bracket({ d, onScore }: { d: Detail; onScore?: (m: MatchV) => void }) {
  const sides = useMemo(() => {
    const order = ["WINNERS", "LOSERS", "GRAND_FINAL", "GROUP", "LEAGUE"];
    return order.map((side) => ({ side, rounds: [...new Set(d.matches.filter((m) => m.bracket === side).map((m) => m.round))].sort((a, b) => a - b) })).filter((s) => s.rounds.length);
  }, [d.matches]);
  const label = (side: string) => ({ WINNERS: d.format === "DOUBLE_ELIMINATION" ? "Winners bracket" : "Bracket", LOSERS: "Losers bracket", GRAND_FINAL: "Grand final", GROUP: "Rounds", LEAGUE: "Fixtures" })[side] ?? side;
  return (
    <div className="grid gap-4">
      {sides.map(({ side, rounds }) => (
        <div key={side}>
          <p className="mb-2 text-xs uppercase tracking-wider text-ink-3">{label(side)}</p>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {rounds.map((r) => (
              <div key={r} className="grid min-w-52 content-start gap-2">
                <p className="text-xs text-ink-3">{side === "GRAND_FINAL" ? "Final" : `Round ${r}`}</p>
                {d.matches.filter((m) => m.bracket === side && m.round === r).map((m) => {
                  const clickable = onScore && m.teamA && m.teamB && ["READY", "SCHEDULED", "LIVE"].includes(m.status);
                  return (
                    <button key={m.id} disabled={!clickable} onClick={() => clickable && onScore!(m)} className={cx("rounded-lg border px-3 py-2 text-left text-sm", clickable ? "border-accent/50 hover:bg-accent-soft" : "border-line", m.status === "WALKOVER" && "opacity-60")}>
                      <SlotLine team={m.teamA} score={m.scoreA} bye={m.byeA} won={!!m.teamA && m.winnerTeamId === m.teamA.id} />
                      <SlotLine team={m.teamB} score={m.scoreB} bye={m.byeB} won={!!m.teamB && m.winnerTeamId === m.teamB.id} />
                      {m.status === "WALKOVER" && <p className="text-[11px] text-ink-3">walkover</p>}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function SlotLine({ team, score, bye, won }: { team: MatchV["teamA"]; score: number | null; bye: boolean; won: boolean }) {
  return (
    <p className={cx("flex justify-between gap-2", won && "font-semibold text-ok")}>
      <span className="truncate">{team?.name ?? <span className="text-ink-3">{bye ? "bye" : "—"}</span>}</span>
      <span className="tabular-nums">{score ?? ""}</span>
    </p>
  );
}

function Score({ m, knockout, onDone }: { m: MatchV; knockout: boolean; onDone: (d: Detail) => void }) {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const save = useAction(async () => onDone(await api<Detail>(`/matches/${m.id}/result`, { method: "POST", body: { scoreA: Number(a), scoreB: Number(b) } })));
  const draw = a !== "" && a === b;
  return (
    <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void save.run(); }}>
      <div className="grid grid-cols-[1fr_80px] items-center gap-2">
        <span className="font-medium">{m.teamA?.name}</span><Input type="number" min={0} value={a} onChange={(e) => setA(e.target.value)} required aria-label="Score A" />
        <span className="font-medium">{m.teamB?.name}</span><Input type="number" min={0} value={b} onChange={(e) => setB(e.target.value)} required aria-label="Score B" />
      </div>
      {draw && knockout && <p className="text-sm text-danger">Knockout matches need a winner.</p>}
      <ErrorNote>{save.error}</ErrorNote>
      <div className="flex justify-end"><Button type="submit" variant="primary" pending={save.pending} disabled={draw && knockout}>Save result</Button></div>
    </form>
  );
}

function Register({ t, onDone }: { t: Detail; onDone: () => void }) {
  const [name, setName] = useState("");
  const [captain, setCaptain] = useState<PickedCustomer | null>(null);
  const [mates, setMates] = useState<PickedCustomer[]>([]);
  const [method, setMethod] = useState("CASH");
  const [key] = useState(idem);
  const fee = Number(t.entryFee) > 0;
  const save = useAction(async () => {
    await api(`/tournaments/${t.id}/teams`, { method: "POST", body: { teamName: name.trim() || captain!.displayName, captainId: captain!.id, playerIds: mates.map((m) => m.id), payment: fee ? { method } : null, idempotencyKey: key } });
    onDone();
  });
  const need = t.teamSize - 1 - mates.length;
  return (
    <div className="grid gap-3 text-sm">
      <Field label="Captain">{<CustomerPicker value={captain} onChange={setCaptain} />}</Field>
      {t.teamSize > 1 && (
        <Field label={`Teammates (${t.teamSize - 1})`}>
          <div className="grid gap-1">
            {mates.map((m) => <p key={m.id} className="flex justify-between">{m.displayName} <button className="text-ink-3" onClick={() => setMates(mates.filter((x) => x.id !== m.id))}>remove</button></p>)}
            {need > 0 && <CustomerPicker value={null} onChange={(c) => c && !mates.some((m) => m.id === c.id) && c.id !== captain?.id && setMates([...mates, c])} />}
          </div>
        </Field>
      )}
      <Field label="Team name" hint={t.teamSize === 1 ? "Blank = the player's name" : undefined}><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} /></Field>
      {fee && (
        <Field label={`Entry fee ${t.currency} ${t.entryFee}`}>
          <Select value={method} onChange={(e) => setMethod(e.target.value)}><option value="CASH">Cash</option><option value="CARD">Card</option><option value="WALLET">Captain's wallet</option></Select>
        </Field>
      )}
      <ErrorNote>{save.error}</ErrorNote>
      <div className="flex justify-end"><Button variant="primary" pending={save.pending} disabled={!captain || need > 0} onClick={() => void save.run()}><UserPlus className="size-4" /> Register</Button></div>
    </div>
  );
}
