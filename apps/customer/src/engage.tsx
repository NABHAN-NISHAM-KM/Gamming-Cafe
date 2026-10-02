import { useEffect, useState } from "react";
import { Camera, Crown, Download, Gift, HeartHandshake, Inbox, Loader2, Medal, Share2, Swords, Trash2, Trophy, Users, X } from "lucide-react";
import { api, key, type Me } from "./api";
import { askConfirm } from "./confirm";
import { locale, t } from "./i18n";
import { Challenges, Leaderboard } from "./more";
import { cx, Loading, Screen, useLoad, type Toast } from "./ui";

/* Rewards (loyalty points, challenges, leaderboard), tournaments, the inbox and screenshots. */

// ── rewards ─────────────────────────────────────────────────────────────────

interface Loyalty {
  points: number;
  referralCode: string | null;
  tier: string | null;
  multiplier: number;
  expiringSoon: number;
  history: Array<{ id: string; at: string; type: string; points: number; reason: string | null }>;
  rewards: Array<{ id: string; name: string; description: string | null; costPoints: number; rewardType: string; stock: number | null; affordable: boolean }>;
}

export function RewardsScreen({ me, toast, onChanged }: { me: Me; toast: Toast; onChanged: () => void }) {
  const l = useLoad(() => api<Loyalty>("/loyalty"));
  const [busy, setBusy] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const redeem = async (r: Loyalty["rewards"][number]) => {
    if (!(await askConfirm(t("Use {n} points for “{name}”?", { n: r.costPoints, name: r.name }), { ok: t("Redeem"), cancel: t("Cancel") }))) return;
    setBusy(r.id);
    try {
      const out = await api<{ code?: string; minutes?: number; walletCredit?: string }>("/loyalty/redeem", { method: "POST", body: { rewardId: r.id, idempotencyKey: key() } });
      if (out.code) setCode(out.code);
      toast(out.code ? t("Here's your code — show it at the counter.") : out.minutes ? t("{n} minutes added to your play time!", { n: out.minutes }) : out.walletCredit ? t("{amount} added to your wallet!", { amount: out.walletCredit }) : t("Redeemed!"));
      l.reload();
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : t("Couldn't redeem that."), false);
    } finally {
      setBusy(null);
    }
  };
  if (!l.data) return <Screen title={t("Rewards")}>{l.error ? <p className="text-alarm">{l.error}</p> : <Loading />}</Screen>;
  const d = l.data;
  return (
    <Screen title={t("Rewards")}>
      <div className="relative overflow-hidden rounded-3xl border border-rim p-6" style={{ background: "linear-gradient(135deg, color-mix(in oklab, var(--color-glow) 30%, var(--color-deck)), var(--color-deck) 70%)" }}>
        <p className="text-sm text-dim">{t("Your points")}</p>
        <p className="tabular mt-1 font-display text-5xl font-semibold">{d.points}</p>
        <p className="mt-2 text-sm text-dim">{t("1 point per AED spent")}{d.multiplier > 1 ? ` · ${t("×{n} as {tier}", { n: d.multiplier, tier: d.tier ?? "" })}` : ""}</p>
        {d.expiringSoon > 0 && <p className="mt-2 text-sm text-warn">{t("{n} points expire in the next 30 days", { n: d.expiringSoon })}</p>}
        <Medal className="absolute end-5 top-5 size-8 text-glow" />
      </div>
      {code && (
        <div className="card mt-4 border-glow/50 p-5 text-center">
          <p className="text-sm text-dim">{t("Your reward code")}</p>
          <p className="mt-1 font-mono text-3xl tracking-widest text-glow">{code}</p>
          <p className="mt-1 text-xs text-dim">{t("Valid 90 days · one use · yours only")}</p>
        </div>
      )}
      <h2 className="mb-3 mt-6 font-display text-lg font-semibold">{t("Treat yourself")}</h2>
      <div className="grid gap-3">
        {d.rewards.map((r) => (
          <div key={r.id} className="card flex items-center gap-4 p-4">
            <Gift className={cx("size-7 shrink-0", r.affordable ? "text-glow" : "text-mute")} />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{r.name}</p>
              {r.description && <p className="text-sm text-dim">{r.description}</p>}
            </div>
            <button disabled={!r.affordable || busy === r.id} onClick={() => void redeem(r)} className="btn btn-primary shrink-0 px-4 py-2 text-sm">
              {busy === r.id ? <Loader2 className="size-4 animate-spin" /> : t("{n} pts", { n: r.costPoints })}
            </button>
          </div>
        ))}
        {d.rewards.length === 0 && <p className="text-dim">{t("No rewards yet — check back soon.")}</p>}
      </div>
      <Challenges />
      <Leaderboard me={me} toast={toast} />
      {d.referralCode && (
        <div className="card mt-6 p-5">
          <p className="flex items-center gap-2 font-semibold"><Users className="size-5 text-glow-2" /> {t("Invite a friend")}</p>
          <p className="mt-1 text-sm text-dim">{t("They sign up with your code; you get bonus points when they first play.")}</p>
          <button
            className="mt-3 w-full rounded-xl bg-void/60 py-3 text-center font-mono text-2xl tracking-widest"
            onClick={() => navigator.clipboard.writeText(d.referralCode!).then(() => toast(t("Invite code copied!")), () => toast(t("Couldn't copy — long-press to select it."), false))}
          >
            {d.referralCode}
          </button>
          <p className="mt-1 text-center text-xs text-dim">{t("Tap to copy")}</p>
        </div>
      )}
      <h2 className="mb-2 mt-6 font-display text-lg font-semibold">{t("History")}</h2>
      <ul className="card divide-y divide-rim">
        {d.history.map((h) => (
          <li key={h.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
            <span className="min-w-0"><span className="block truncate">{h.reason ?? h.type.toLowerCase()}</span><span className="text-xs text-dim">{new Date(h.at).toLocaleDateString(locale())}</span></span>
            <span className={cx("tabular font-semibold", h.points < 0 ? "text-alarm" : "text-good")} dir="ltr">{h.points > 0 ? "+" : ""}{h.points}</span>
          </li>
        ))}
        {d.history.length === 0 && <li className="p-4 text-sm text-dim">{t("Play or order to start collecting points.")}</li>}
      </ul>
    </Screen>
  );
}

// ── tournaments ─────────────────────────────────────────────────────────────

interface TRow { id: string; name: string; status: string; format: string; game: string | null; branch: string; startsAt: string; teamSize: number; maxTeams: number; entered: number; entryFee: string; prizePool: string; currency: string; myTeam: { name: string; status: string; finalPlacement: number | null } | null }
interface TMatch { id: string; bracket: string; round: number; status: string; teamA: { id: string; name: string } | null; teamB: { id: string; name: string } | null; scoreA: number | null; scoreB: number | null; winnerTeamId: string | null }
interface TDetail extends Omit<TRow, "myTeam" | "branch"> {
  description: string | null;
  rules: string | null;
  prizeDistribution: Array<{ place: number; amount: number }>;
  myTeamId: string | null;
  teams: Array<{ id: string; name: string; status: string; finalPlacement: number | null; players: Array<{ displayName: string }> }>;
  matches: TMatch[];
  standings: Array<{ team: string; name: string; points: number; wins: number; draws: number; losses: number }> | null;
}
const FORMAT: Record<string, string> = { SINGLE_ELIMINATION: "Knockout", DOUBLE_ELIMINATION: "Double elimination", ROUND_ROBIN: "Round robin", LEAGUE: "League", SWISS: "Swiss" };
const STATUS: Record<string, string> = { REGISTRATION_OPEN: "Entries open", REGISTRATION_CLOSED: "Entries closed", CHECK_IN: "Check-in", IN_PROGRESS: "Live", COMPLETED: "Finished" };
const dateTime = (iso: string, long = false) => new Date(iso).toLocaleString(locale(), { weekday: long ? "long" : "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function TournamentsScreen({ toast, onChanged }: { toast: Toast; onChanged: () => void }) {
  const list = useLoad(() => api<TRow[]>("/tournaments"));
  const [open, setOpen] = useState<string | null>(null);
  if (open) return <TournamentDetail id={open} back={() => { setOpen(null); list.reload(); }} toast={toast} onChanged={onChanged} />;
  return (
    <Screen title={t("Tournaments")}>
      {!list.data ? (list.error ? <p className="text-alarm">{list.error}</p> : <Loading />) : list.data.length === 0 ? (
        <div className="card p-8 text-center text-dim"><Trophy className="mx-auto size-10 opacity-60" /><p className="mt-3">{t("No tournaments right now. Check back soon!")}</p></div>
      ) : (
        <div className="grid gap-3">
          {list.data.map((x) => (
            <button key={x.id} onClick={() => setOpen(x.id)} className="card w-full p-5 text-start">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-display text-lg font-semibold">{x.name}</p>
                  <p className="text-sm text-dim">{x.game ?? "—"} · {t(FORMAT[x.format] ?? x.format)} · {x.teamSize === 1 ? "1v1" : `${x.teamSize}v${x.teamSize}`}</p>
                </div>
                <span className={cx("shrink-0 rounded-full px-3 py-1 text-xs font-semibold", x.status === "IN_PROGRESS" ? "bg-good/20 text-good" : x.status === "REGISTRATION_OPEN" ? "bg-glow/20 text-glow" : "bg-rim text-dim")}>{t(STATUS[x.status] ?? x.status)}</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                <span>{dateTime(x.startsAt)}</span>
                <span className="text-dim">{t("{n}/{max} in", { n: x.entered, max: x.maxTeams })}</span>
                {Number(x.prizePool) > 0 && <span className="text-warn">{t("{amount} prizes", { amount: `${x.currency} ${Number(x.prizePool)}` })}</span>}
              </div>
              {x.myTeam && <p className="mt-2 text-sm text-good">{x.myTeam.finalPlacement ? t("You're in — finished #{n}", { n: x.myTeam.finalPlacement }) : t("You're in")}</p>}
            </button>
          ))}
        </div>
      )}
    </Screen>
  );
}

function TournamentDetail({ id, back, toast, onChanged }: { id: string; back: () => void; toast: Toast; onChanged: () => void }) {
  const tr = useLoad(() => api<TDetail>(`/tournaments/${id}`), [id]);
  const [team, setTeam] = useState("");
  const [mates, setMates] = useState("");
  const [busy, setBusy] = useState(false);
  if (!tr.data) return <Screen title={t("Tournament")} back={back}>{tr.error ? <p className="text-alarm">{tr.error}</p> : <Loading />}</Screen>;
  const d = tr.data;
  const enter = async () => {
    setBusy(true);
    try {
      await api(`/tournaments/${id}/register`, { method: "POST", body: { teamName: team.trim(), teammates: mates.split(/[\s,]+/).map((s) => s.replace(/^@/, "")).filter(Boolean), idempotencyKey: key() } });
      toast(Number(d.entryFee) > 0 ? t("You're in! {amount} paid from your wallet.", { amount: `${d.currency} ${d.entryFee}` }) : t("You're in!"));
      tr.reload();
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : t("Couldn't enter."), false);
    } finally {
      setBusy(false);
    }
  };
  const rounds = [...new Set(d.matches.filter((m) => m.bracket !== "LOSERS").map((m) => `${m.bracket}:${m.round}`))];
  return (
    <Screen title={d.name} back={back}>
      <div className="card p-5 text-sm">
        <p className="text-dim">{d.game ?? "—"} · {t(FORMAT[d.format] ?? d.format)} · {dateTime(d.startsAt, true)}</p>
        {d.description && <p className="mt-2">{d.description}</p>}
        <div className="mt-3 flex flex-wrap gap-4">
          <span>{t("Entry")}: <strong>{Number(d.entryFee) > 0 ? `${d.currency} ${d.entryFee}` : t("Free")}</strong></span>
          {d.prizeDistribution.length > 0 && <span className="text-warn">{t("Prizes")}: {d.prizeDistribution.map((p) => `#${p.place} ${d.currency} ${p.amount}`).join(" · ")}</span>}
        </div>
        {d.rules && <p className="mt-3 text-xs text-dim">{d.rules}</p>}
      </div>
      {!d.myTeamId && d.status === "REGISTRATION_OPEN" && d.entered < d.maxTeams && (
        <form className="card mt-4 grid gap-3 p-5" onSubmit={(e) => { e.preventDefault(); void enter(); }}>
          <p className="font-semibold">{t("Enter")}</p>
          <input className="field" value={team} onChange={(e) => setTeam(e.target.value)} placeholder={d.teamSize === 1 ? t("Your gamer tag") : t("Team name")} required maxLength={40} />
          {d.teamSize > 1 && <input className="field" value={mates} onChange={(e) => setMates(e.target.value)} placeholder={t("Teammates' usernames ({n}), separated by spaces", { n: d.teamSize - 1 })} required />}
          <button className="btn btn-primary" disabled={busy}>{busy ? <Loader2 className="size-5 animate-spin" /> : <Swords className="size-5" />} {Number(d.entryFee) > 0 ? t("Enter · {amount} from wallet", { amount: `${d.currency} ${d.entryFee}` }) : t("Enter for free")}</button>
        </form>
      )}
      {d.myTeamId && <p className="mt-4 rounded-2xl bg-good/15 px-4 py-3 text-good">{t("You're in this tournament. Arrive 15 minutes early to check in.")}</p>}

      {d.standings && d.matches.length > 0 && (
        <div className="card mt-4 overflow-hidden">
          {d.standings.map((s, i) => (
            <div key={s.team} className={cx("flex items-center gap-3 px-4 py-2.5 text-sm", i > 0 && "border-t border-rim", s.team === d.myTeamId && "bg-glow/10")}>
              <span className="w-5 text-dim">{i + 1}</span><span className="flex-1 font-medium">{s.name}</span><span className="text-dim" dir="ltr">{s.wins}-{s.draws}-{s.losses}</span><span className="tabular w-8 text-end font-semibold">{s.points}</span>
            </div>
          ))}
        </div>
      )}
      {!d.standings && rounds.length > 0 && (
        <div className="mt-4 grid gap-4">
          {rounds.map((r) => {
            const [side, round] = r.split(":");
            const ms = d.matches.filter((m) => m.bracket === side && String(m.round) === round && (m.teamA || m.teamB));
            if (!ms.length) return null;
            return (
              <div key={r}>
                <p className="mb-2 text-xs uppercase tracking-wider text-dim">{side === "GRAND_FINAL" ? t("Grand final") : t("Round {n}", { n: round ?? "" })}</p>
                <div className="grid gap-2">
                  {ms.map((m) => (
                    <div key={m.id} className="card px-4 py-2 text-sm">
                      {[[m.teamA, m.scoreA], [m.teamB, m.scoreB]].map(([tm, sc], i) => {
                        const x = tm as TMatch["teamA"];
                        return (
                          <p key={i} className={cx("flex justify-between", x && x.id === m.winnerTeamId && "font-semibold text-good", x && x.id === d.myTeamId && "text-glow")}>
                            <span>{x?.name ?? "—"}</span><span className="tabular">{(sc as number | null) ?? ""}</span>
                          </p>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {d.status === "COMPLETED" && (
        <div className="card mt-4 p-5">
          {d.teams.filter((x) => x.finalPlacement && x.finalPlacement <= 3).sort((a, b) => a.finalPlacement! - b.finalPlacement!).map((x) => (
            <p key={x.id} className="flex items-center gap-2 py-1"><Crown className={cx("size-4", x.finalPlacement === 1 ? "text-warn" : "text-dim")} /> #{x.finalPlacement} {x.name}</p>
          ))}
        </div>
      )}
    </Screen>
  );
}

// ── inbox ───────────────────────────────────────────────────────────────────

interface Message { id: string; title: string | null; body: string; data: { code?: string | null; bookingId?: string; share?: string; currency?: string; paid?: boolean } | null; readAt: string | null; createdAt: string }

export function InboxScreen({ back, onRead, toast, onChanged }: { back: () => void; onRead: () => void; toast: Toast; onChanged: () => void }) {
  const list = useLoad(() => api<Message[]>("/inbox"));
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    const unread = (list.data ?? []).filter((m) => !m.readAt && !(m.data?.bookingId && !m.data.paid));
    if (!unread.length) return;
    void Promise.all(unread.map((m) => api(`/inbox/${m.id}/read`, { method: "POST" }))).then(onRead);
  }, [list.data, onRead]);
  const payShare = async (m: Message) => {
    if (!(await askConfirm(t("Pay your share of {amount} from your wallet?", { amount: `${m.data!.currency} ${m.data!.share}` }), { ok: t("Pay"), cancel: t("Cancel") }))) return;
    setBusy(m.id);
    try {
      await api(`/inbox/${m.id}/pay-share`, { method: "POST" });
      toast(t("Paid — thanks for chipping in!"));
      list.reload();
      onRead();
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : t("Couldn't pay that."), false);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Screen title={t("Inbox")} back={back}>
      {!list.data ? <Loading /> : list.data.length === 0 ? (
        <div className="card p-8 text-center text-dim"><Inbox className="mx-auto size-10 opacity-60" /><p className="mt-3">{t("No messages yet.")}</p></div>
      ) : (
        <div className="grid gap-3">
          {list.data.map((m) => (
            <div key={m.id} className={cx("card p-5", !m.readAt && "border-glow/50")}>
              {m.title && <p className="font-semibold">{m.title}</p>}
              <p className="mt-1 whitespace-pre-line text-sm">{m.body}</p>
              {m.data?.code && <p className="mt-3 rounded-xl bg-void/60 py-2 text-center font-mono text-xl tracking-widest text-glow">{m.data.code}</p>}
              {m.data?.bookingId && (m.data.paid ? (
                <p className="mt-3 text-sm text-good">{t("You paid your share.")}</p>
              ) : (
                <button className="btn btn-primary mt-3 w-full" disabled={busy === m.id} onClick={() => void payShare(m)}>
                  {busy === m.id ? <Loader2 className="size-5 animate-spin" /> : <HeartHandshake className="size-5" />} {t("Pay my share · {amount}", { amount: `${m.data.currency} ${m.data.share}` })}
                </button>
              ))}
              <p className="mt-2 text-xs text-dim">{new Date(m.createdAt).toLocaleString(locale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
            </div>
          ))}
        </div>
      )}
    </Screen>
  );
}

// ── screenshots ─────────────────────────────────────────────────────────────

interface Shot { id: string; takenAt: string; expiresAt: string; width: number; height: number; thumb: string }

/** Screenshots taken on a gaming PC (Print Screen or the Shell's camera button), kept for 30 days. */
export function ScreenshotsScreen({ back, toast }: { back: () => void; toast: Toast }) {
  const list = useLoad(() => api<Shot[]>("/screenshots"));
  const [open, setOpen] = useState<{ id: string; image: string | null } | null>(null);

  const view = async (id: string) => {
    setOpen({ id, image: null });
    try {
      const r = await api<{ image: string }>(`/screenshots/${id}`);
      setOpen((o) => (o?.id === id ? { id, image: r.image } : o));
    } catch {
      setOpen(null);
      toast(t("Couldn't open that screenshot."), false);
    }
  };
  const save = async (image: string, id: string) => {
    const blob = await (await fetch(image)).blob();
    const file = new File([blob], `arena-${id.slice(0, 8)}.jpg`, { type: "image/jpeg" });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] }).catch(() => undefined);
      return;
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const remove = async (id: string) => {
    if (!(await askConfirm(t("Delete this screenshot?"), { ok: t("Delete"), cancel: t("Cancel") }))) return;
    await api(`/screenshots/${id}`, { method: "DELETE" });
    setOpen(null);
    list.reload();
  };

  return (
    <Screen title={t("Screenshots")} back={back}>
      {!list.data ? <Loading /> : list.data.length === 0 ? (
        <div className="card p-8 text-center text-dim">
          <Camera className="mx-auto size-10 opacity-60" />
          <p className="mt-3">{t("No screenshots yet.")}</p>
          <p className="mt-1 text-sm">{t("Press Print Screen on a gaming PC while you play — they show up here for 30 days.")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {list.data.map((s) => (
            <button key={s.id} onClick={() => void view(s.id)} className="card press overflow-hidden p-0 text-start">
              <img src={s.thumb} alt="" className="aspect-video w-full object-cover" />
              <p className="px-3 py-2 text-xs text-dim">{new Date(s.takenAt).toLocaleString(locale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
            </button>
          ))}
        </div>
      )}
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/90 p-4" onClick={() => setOpen(null)}>
          <button onClick={() => setOpen(null)} aria-label={t("Close")} className="absolute end-4 top-4 rounded-full bg-white/10 p-2"><X className="size-6" /></button>
          {!open.image ? <Loader2 className="size-8 animate-spin text-glow" /> : (
            <div className="grid w-full max-w-3xl gap-4" onClick={(e) => e.stopPropagation()}>
              <img src={open.image} alt={t("Screenshot")} className="w-full rounded-xl" />
              <div className="flex justify-center gap-3">
                <button onClick={() => void save(open.image!, open.id)} className="btn btn-primary">{typeof navigator.share === "function" ? <Share2 className="size-5" /> : <Download className="size-5" />} {t("Save")}</button>
                <button onClick={() => void remove(open.id)} className="btn btn-ghost text-alarm"><Trash2 className="size-5" /> {t("Delete")}</button>
              </div>
            </div>
          )}
        </div>
      )}
    </Screen>
  );
}
