"use client";

import { useEffect, useState } from "react";
import { AppWindow, Download, Gamepad2, Plus, RefreshCcw, Search, Star } from "lucide-react";
import { api } from "@/lib/client/api";
import { useBranch } from "@/lib/client/branch";
import { useAction, useApi } from "@/lib/client/hooks";
import { useCan } from "@/lib/client/me";
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Table, cx } from "@/components/ui";

interface Game {
  id: string;
  slug: string;
  title: string;
  custom: boolean;
  categories: string[];
  ageRating: string | null;
  minAge: number | null;
  launcherGameId: string | null;
  executablePath: string | null;
  launcher: { key: string; name: string } | null;
  setting: { isEnabled: boolean; isFeatured: boolean; sortOrder: number; minAgeOverride: number | null; allowedZoneIds: string[] } | null;
  installs?: { installed: number; updateRequired: number };
}
interface Job {
  id: string;
  status: string;
  progressPct: number;
  devicesDone: number;
  devicesTotal: number;
  scheduledFor: string;
  completedAt: string | null;
  error: string | null;
  game: { id: string; title: string };
}
interface App {
  id: string;
  organizationId: string | null;
  name: string;
  kind: string;
  executablePath: string;
  arguments: string | null;
  isActive: boolean;
}
interface Zone {
  id: string;
  name: string;
}

const JOB_TONE: Record<string, "neutral" | "accent" | "ok" | "warn" | "danger"> = { SCHEDULED: "neutral", RUNNING: "accent", COMPLETED: "ok", FAILED: "danger", CANCELLED: "neutral", PAUSED: "warn" };
const updatable = (g: Game) => !!g.launcherGameId && (g.launcher?.key === "STEAM" || g.launcher?.key === "EPIC");

export default function GamesPage() {
  const can = useCan();
  const { branches, branchId, setBranchId } = useBranch();
  const [tab, setTab] = useState<"library" | "updates" | "apps">("library");
  const lib = useApi<{ stations: number | null; games: Game[] }>(branchId ? `/games?branchId=${branchId}` : null);
  const jobs = useApi<Job[]>(branchId ? `/branches/${branchId}/game-updates` : null);
  const zones = useApi<Zone[]>(branchId ? `/branches/${branchId}/zones` : null);
  const [adding, setAdding] = useState(false);
  const [zonesFor, setZonesFor] = useState<Game | null>(null);
  const [q, setQ] = useState("");
  const [note, setNote] = useState<string | null>(null);

  const manage = can("game.manage");
  const update = can("game.update", branchId ?? undefined);
  const running = jobs.data?.some((j) => j.status === "RUNNING" || j.status === "SCHEDULED");

  // Update jobs move on their own; follow them while any is active.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void Promise.all([jobs.reload(), lib.reload()]), 3000);
    return () => clearInterval(t);
  }, [running, jobs, lib]);

  const setSetting = useAction(async (g: Game, patch: Partial<NonNullable<Game["setting"]>>) => {
    await api(`/games/${g.id}/settings`, { method: "PUT", action: "Update game", body: patch });
    await lib.reload();
  });
  const scan = useAction(async () => {
    const r = await api<{ requested: number; offline: number }>(`/branches/${branchId}/game-scan`, { method: "POST", action: "Scan PCs" });
    setNote(`Asked ${r.requested} online PC(s) to rescan their games${r.offline ? ` (${r.offline} offline)` : ""}. Results appear within a minute.`);
    setTimeout(() => void lib.reload(), 3000);
  });
  const schedule = useAction(async (g: Game) => {
    await api(`/branches/${branchId}/game-updates`, { method: "POST", action: "Update game", body: { gameId: g.id } });
    setTab("updates");
    await jobs.reload();
  });
  const cancel = useAction(async (j: Job) => {
    await api(`/game-updates/${j.id}/cancel`, { method: "POST", action: "Cancel update" });
    await jobs.reload();
  });

  const games = (lib.data?.games ?? []).filter((g) => !q || g.title.toLowerCase().includes(q.toLowerCase()));
  const stations = lib.data?.stations ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Games"
        subtitle="What customers can play, where it's installed, and keeping it up to date."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {branches.data && branches.data.length > 1 && (
              <Select value={branchId ?? ""} onChange={(e) => setBranchId(e.target.value)} className="w-auto">
                {branches.data.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
              </Select>
            )}
            {update && <Button onClick={() => void scan.run()} pending={scan.pending}><RefreshCcw className="size-4" /> Scan PCs</Button>}
            {manage && <Button variant="primary" onClick={() => setAdding(true)}><Plus className="size-4" /> Add game</Button>}
          </div>
        }
      />
      {note && <p className="rounded-lg border border-accent/30 bg-accent/10 px-4 py-2 text-sm text-accent">{note}</p>}
      <ErrorNote>{scan.error ?? schedule.error ?? setSetting.error ?? cancel.error}</ErrorNote>

      <div className="flex gap-1 border-b border-line">
        {([["library", "Library", Gamepad2], ["updates", "Updates", Download], ["apps", "Apps", AppWindow]] as const).map(([id, label, Icon]) => (
          <button key={id} onClick={() => setTab(id)} className={cx("flex items-center gap-2 border-b-2 px-4 py-2 text-sm", tab === id ? "border-accent text-accent" : "border-transparent text-ink-2 hover:text-ink")}>
            <Icon className="size-4" /> {label}
            {id === "updates" && running && <span className="size-2 animate-pulse rounded-full bg-accent" />}
          </button>
        ))}
      </div>

      {tab === "library" && (
        <Card>
          <div className="flex items-center gap-2 border-b border-line px-4 py-3">
            <Search className="size-4 text-ink-3" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search games" className="w-full bg-transparent text-sm outline-none" />
          </div>
          {lib.loading && !lib.data ? (
            <Spinner />
          ) : games.length === 0 ? (
            <Empty icon={<Gamepad2 className="size-8" />} title="No games" />
          ) : (
            <Table head={["Game", "Launcher", "Rating", `Installed (of ${stations})`, "Shown in Shell", "Zones", ""]}>
              {games.map((g) => {
                const s = g.setting;
                const pending = g.installs?.updateRequired ?? 0;
                return (
                  <tr key={g.id} className={cx(!s?.isEnabled && "opacity-60")}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {manage ? (
                          <button onClick={() => void setSetting.run(g, { isFeatured: !s?.isFeatured })} title={s?.isFeatured ? "Featured — click to unfeature" : "Feature on the Shell home screen"}>
                            <Star className={cx("size-4", s?.isFeatured ? "fill-reserved text-reserved" : "text-ink-3")} />
                          </button>
                        ) : s?.isFeatured && <Star className="size-4 fill-reserved text-reserved" />}
                        <span className="font-medium">{g.title}</span>
                        {g.custom && <Badge tone="accent">Custom</Badge>}
                      </div>
                      <p className="mt-0.5 text-xs text-ink-3">{g.categories.join(" · ").toLowerCase()}</p>
                    </td>
                    <td className="px-4 py-3 text-ink-2">{g.launcher?.name ?? "Executable"}{g.launcherGameId ? <span className="text-ink-3"> · {g.launcherGameId}</span> : null}</td>
                    <td className="px-4 py-3 text-ink-2">{g.ageRating ?? (g.minAge ? `${g.minAge}+` : "—")}</td>
                    <td className="px-4 py-3">
                      <span className="tabular-nums">{g.installs?.installed ?? 0}</span>
                      {pending > 0 && (
                        <span className="ml-2">
                          <Badge tone="warn">{pending} need update</Badge>
                          {update && updatable(g) && (
                            <Button size="sm" className="ml-2" onClick={() => void schedule.run(g)} pending={schedule.pending}>Update</Button>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <label className="inline-flex items-center gap-2">
                        <input type="checkbox" disabled={!manage} checked={s?.isEnabled ?? false} onChange={(e) => void setSetting.run(g, { isEnabled: e.target.checked })} />
                        <span className="text-ink-2">{s?.isEnabled ? "Yes" : "No"}</span>
                      </label>
                    </td>
                    <td className="px-4 py-3">
                      <button disabled={!manage} onClick={() => setZonesFor(g)} className="text-ink-2 hover:text-accent disabled:hover:text-ink-2">
                        {s?.allowedZoneIds.length ? `${s.allowedZoneIds.length} zone(s)` : "All zones"}
                      </button>
                    </td>
                    <td />
                  </tr>
                );
              })}
            </Table>
          )}
        </Card>
      )}

      {tab === "updates" && (
        <Card>
          {!jobs.data?.length ? (
            <Empty icon={<Download className="size-8" />} title="No updates yet">
              When PCs report that a Steam or Epic game needs an update, press <b>Update</b> next to it in the library. Idle PCs are updated a few at a time; PCs with a customer on them are never interrupted.
            </Empty>
          ) : (
            <Table head={["Game", "Status", "Progress", "Started", ""]}>
              {jobs.data.map((j) => (
                <tr key={j.id}>
                  <td className="px-4 py-3 font-medium">{j.game.title}</td>
                  <td className="px-4 py-3">
                    <Badge tone={JOB_TONE[j.status] ?? "neutral"}>{j.status.toLowerCase()}</Badge>
                    {j.error && <p className="mt-1 max-w-xs text-xs text-ink-3">{j.error}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-2 w-40 overflow-hidden rounded-full bg-panel-2"><div className="h-full bg-accent transition-all" style={{ width: `${j.progressPct}%` }} /></div>
                      <span className="tabular-nums text-ink-2">{j.devicesDone}/{j.devicesTotal} PCs</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-ink-2">{new Date(j.scheduledFor).toLocaleString()}</td>
                  <td className="px-4 py-3 text-right">
                    {update && (j.status === "RUNNING" || j.status === "SCHEDULED") && <Button size="sm" variant="ghost" onClick={() => void cancel.run(j)}>Cancel</Button>}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {tab === "apps" && <AppsTab manage={manage} />}

      <Modal open={adding} onClose={() => setAdding(false)} title="Add a game" wide>
        <AddGame onDone={() => { setAdding(false); void lib.reload(); }} />
      </Modal>
      <Modal open={!!zonesFor} onClose={() => setZonesFor(null)} title={`Where can ${zonesFor?.title ?? ""} be played?`}>
        {zonesFor && <ZonePicker game={zonesFor} zones={zones.data ?? []} onDone={() => { setZonesFor(null); void lib.reload(); }} />}
      </Modal>
    </div>
  );
}

function ZonePicker({ game, zones, onDone }: { game: Game; zones: Zone[]; onDone: () => void }) {
  const [sel, setSel] = useState<string[]>(game.setting?.allowedZoneIds ?? []);
  const save = useAction(async () => {
    await api(`/games/${game.id}/settings`, { method: "PUT", action: "Update game zones", body: { allowedZoneIds: sel } });
    onDone();
  });
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-2">Leave everything unticked to allow it everywhere. PCs update within seconds.</p>
      <div className="space-y-2">
        {zones.map((z) => (
          <label key={z.id} className="flex items-center gap-2">
            <input type="checkbox" checked={sel.includes(z.id)} onChange={(e) => setSel((s) => (e.target.checked ? [...s, z.id] : s.filter((x) => x !== z.id)))} />
            {z.name}
          </label>
        ))}
      </div>
      <ErrorNote>{save.error}</ErrorNote>
      <div className="flex justify-end"><Button variant="primary" onClick={() => void save.run()} pending={save.pending}>Save</Button></div>
    </div>
  );
}

function AddGame({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ title: "", how: "STEAM", storeId: "", exe: "", args: "", process: "", minAge: "" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = useAction(async () => {
    const byLauncher = f.how === "STEAM" || f.how === "EPIC";
    await api("/games", {
      method: "POST",
      action: "Add game",
      body: {
        title: f.title,
        launcherKey: f.how === "EXE" ? null : f.how,
        launcherGameId: byLauncher ? f.storeId : null,
        executablePath: byLauncher ? null : f.exe,
        arguments: byLauncher ? null : f.args || null,
        processNames: f.process ? f.process.split(",").map((p) => p.trim()).filter(Boolean) : [],
        minAge: f.minAge ? Number(f.minAge) : null,
      },
    });
    onDone();
  });
  const byLauncher = f.how === "STEAM" || f.how === "EPIC";
  return (
    <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void save.run(); }}>
      <Field label="Title" className="sm:col-span-2"><Input required value={f.title} onChange={set("title")} placeholder="Deadlock" /></Field>
      <Field label="Started through">
        <Select value={f.how} onChange={set("how")}>
          <option value="STEAM">Steam</option>
          <option value="EPIC">Epic Games</option>
          <option value="RIOT">Riot Client (executable)</option>
          <option value="EXE">Its own executable</option>
        </Select>
      </Field>
      {byLauncher ? (
        <Field label={f.how === "STEAM" ? "Steam app id" : "Epic app name"} hint={f.how === "STEAM" ? "The number in the store URL, e.g. 730" : "From the launcher manifest, e.g. Fortnite"}>
          <Input required value={f.storeId} onChange={set("storeId")} />
        </Field>
      ) : (
        <>
          <Field label="Executable" hint="Full path on the PCs" className="sm:col-span-2"><Input required value={f.exe} onChange={set("exe")} placeholder="C:\Games\MyGame\MyGame.exe" /></Field>
          <Field label="Arguments"><Input value={f.args} onChange={set("args")} /></Field>
        </>
      )}
      <Field label="Game process names" hint="Comma separated — closed when the session ends"><Input value={f.process} onChange={set("process")} placeholder="game.exe" /></Field>
      <Field label="Minimum age"><Input inputMode="numeric" value={f.minAge} onChange={set("minAge")} placeholder="e.g. 16" /></Field>
      <div className="sm:col-span-2"><ErrorNote>{save.error}</ErrorNote></div>
      <div className="flex justify-end sm:col-span-2"><Button type="submit" variant="primary" pending={save.pending}>Add game</Button></div>
    </form>
  );
}

function AppsTab({ manage }: { manage: boolean }) {
  const apps = useApi<App[]>("/shell-apps");
  const [f, setF] = useState({ name: "", kind: "COMMUNICATION", exe: "", args: "" });
  const add = useAction(async () => {
    await api("/shell-apps", { method: "POST", action: "Add app", body: { name: f.name, kind: f.kind, executablePath: f.exe, arguments: f.args || null } });
    setF({ name: "", kind: "COMMUNICATION", exe: "", args: "" });
    await apps.reload();
  });
  return (
    <Card>
      {!apps.data ? <Spinner /> : (
        <Table head={["App", "Shown under", "Program", ""]}>
          {apps.data.map((a) => (
            <tr key={a.id}>
              <td className="px-4 py-3 font-medium">{a.name}{!a.organizationId && <span className="ml-2 text-xs text-ink-3">built-in</span>}</td>
              <td className="px-4 py-3 text-ink-2">{a.kind === "BROWSER" ? "Internet" : a.kind === "PLATFORM_LAUNCHER" ? "Platforms" : "Apps"}</td>
              <td className="px-4 py-3 font-mono text-xs text-ink-3">{a.executablePath} {a.arguments}</td>
              <td />
            </tr>
          ))}
        </Table>
      )}
      {manage && (
        <form className="grid gap-3 border-t border-line p-4 sm:grid-cols-[1fr_auto_2fr_1fr_auto]" onSubmit={(e) => { e.preventDefault(); void add.run(); }}>
          <Input required placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} className="w-auto">
            <option value="COMMUNICATION">Chat</option>
            <option value="MEDIA">Media</option>
            <option value="UTILITY">Utility</option>
            <option value="BROWSER">Browser</option>
            <option value="PLATFORM_LAUNCHER">Game platform</option>
          </Select>
          <Input required placeholder="C:\Program Files\App\app.exe" value={f.exe} onChange={(e) => setF({ ...f, exe: e.target.value })} />
          <Input placeholder="Arguments" value={f.args} onChange={(e) => setF({ ...f, args: e.target.value })} />
          <Button type="submit" pending={add.pending}><Plus className="size-4" /> Add</Button>
          <div className="sm:col-span-5"><ErrorNote>{add.error}</ErrorNote></div>
        </form>
      )}
    </Card>
  );
}
