// Gaming Shell ↔ demo venue. The Shell demo runs as one station on the demo
// floor, so staff actions in the admin demo reach it and vice versa.
import { money, nowIso, num, uuid, type Engine } from "./engine";
import type { StaffBackend } from "./staff";

export interface ShellLink {
  stationName: string;
  venue: { name: string; branchName: string };
  session(): { id: string; customerName: string; tier: string | null; startedAt: string; expiresAt: string | null; customerAge: number | null } | null;
  login(username: string, secret: string): { ok: true } | { ok: false; error: string; message: string };
  logout(): void;
  menu(): { currency: string; canPayWithWallet: boolean; categories: any[] };
  order(lines: Array<{ productId: string; quantity: number; modifierIds: string[] }>, notes: string | undefined, payWith: "BILL" | "WALLET"): Promise<{ ok: boolean; orderId?: string; number?: string; total?: string; currency?: string; error?: string; message?: string }>;
  help(topic: string): void;
  /** Station/session changes and staff messages, pushed by the venue. */
  onChange(fn: (e: { kind: "state" } | { kind: "message"; title: string; text: string } | { kind: "order"; orderId: string; number: string; status: string }) => void): () => void;
}

const PASSWORDS: Record<string, string[]> = { ahmed: ["ahmed123", "1234"], sara: ["sara1234"] };
const AGES: Record<string, number> = { sara: 13 };

export function createShellLink(e: Engine, staff: StaffBackend, stationName: string, api: (method: string, path: string, body?: unknown) => Promise<{ status: number; body: any }>): ShellLink {
  const station = () => staff.allDevices().find((d) => d.name.toLowerCase() === stationName.toLowerCase()) ?? staff.allDevices().find((d) => d.kind === "GAMING_PC");
  const branch = () => staff.branches().find((b) => b.id === station()?.branchId);
  const org = () => e.get("staff", "/organization");
  const ordersMine = new Map<string, string>(); // orderId → last status told to the player

  return {
    stationName: station()?.name ?? stationName,
    venue: { name: org()?.displayName ?? "Demo Arena", branchName: branch()?.name ?? "Dubai Marina" },

    session() {
      const d = station();
      const s = d?.session;
      if (!s) return null;
      const c = s.customer ? staff.customers().find((x) => x.id === s.customer.id) : null;
      return { id: s.id, customerName: s.customer?.displayName ?? s.guestLabel ?? "Guest", tier: c?.membershipTier?.name ?? null, startedAt: s.startedAt, expiresAt: s.expiresAt, customerAge: c ? (AGES[c.username] ?? 25) : null };
    },

    login(username, secret) {
      const d = station();
      if (!d) return { ok: false, error: "no_station", message: "This station isn't on the demo floor." };
      const u = username.trim().toLowerCase();
      const c = staff.customers().find((x) => x.username === u);
      const valid = c && (PASSWORDS[u] ? PASSWORDS[u]!.includes(secret) : secret === "player1234");
      if (!c || !valid) return { ok: false, error: "invalid_credentials", message: "Wrong username or password." };
      if (d.session) return { ok: false, error: "station_busy", message: "Someone is already playing here." };
      const w = staff.walletDoc(c.id);
      try {
        if (w.timeMinutes > 0) staff.startSession(d, { customerId: c.id, payment: { method: "TIME_BALANCE" } });
        else if (num(w.total) >= 15) staff.startSession(d, { customerId: c.id, request: { kind: "minutes", minutes: 60 }, payment: { method: "WALLET" } });
        else return { ok: false, error: "no_balance", message: "No time or credit left — top up at the counter (or in the admin demo)." };
      } catch (err) {
        return { ok: false, error: "failed", message: err instanceof Error ? err.message : "Couldn't start." };
      }
      e.commit();
      return { ok: true };
    },

    logout() {
      const s = station()?.session;
      if (s) {
        staff.endSession(s.id, "Customer logged out");
        e.commit();
      }
    },

    menu() {
      const m = e.get("staff", `/branches/${station()?.branchId}/menu`) ?? { currency: "AED", categories: [] };
      return {
        currency: m.currency,
        canPayWithWallet: !!station()?.session?.customer,
        categories: m.categories
          .filter((c: any) => c.showInShell !== false)
          .map((c: any) => ({ id: c.id, name: c.name, products: c.products.map((p: any) => ({ id: p.id, name: p.name, description: p.description, price: p.price, available: p.available, modifierGroups: p.modifierGroups })) })),
      };
    },

    async order(lines, notes, payWith) {
      const d = station();
      if (!d?.session) return { ok: false, error: "no_session", message: "Sign in first." };
      const res = await api("POST", `/branches/${d.branchId}/orders`, {
        type: "GAMING_SEAT", deviceId: d.id, customerId: d.session.customer?.id ?? null, lines, notes: notes ?? null,
        payments: payWith === "WALLET" ? [{ method: "WALLET" }] : undefined, idempotencyKey: uuid(),
      });
      if (res.status >= 400) return { ok: false, error: res.body?.error, message: res.body?.error === "insufficient_funds" ? "Not enough credit in your wallet." : "Couldn't place the order." };
      ordersMine.set(res.body.id, "NEW");
      return { ok: true, orderId: res.body.id, number: res.body.number, total: money(num(res.body.total)), currency: org()?.defaultCurrency ?? "AED" };
    },

    help(topic) {
      const d = station();
      if (!d) return;
      const alert = { id: uuid(), deviceId: d.id, type: "HELP_REQUEST", severity: "WARNING", status: "OPEN", title: `${d.name} needs help: ${topic}`, openedAt: nowIso() };
      e.get("staff", `/branches/${d.branchId}/floor`)?.alerts?.unshift(alert);
      e.emit({ type: "alert", branchId: d.branchId, alert });
      e.commit();
    },

    onChange(fn) {
      return e.on((ev) => {
        const d = station();
        if (!d) return;
        if (ev.type === "changed" || (ev.type === "device" && ev.device.id === d.id)) fn({ kind: "state" });
        if (ev.type === "command" && ev.command.deviceId === d.id && ev.command.status === "SENT") {
          const p = ev.command.payload ?? {};
          if (ev.command.type === "MESSAGE") fn({ kind: "message", title: p.title ?? "Message from staff", text: p.text ?? p.message ?? "" });
          if (ev.command.type === "LOCK") fn({ kind: "message", title: "Station locked", text: "Staff locked this station. Please call a staff member." });
        }
        if (ev.type === "kitchen" || ev.type === "changed") {
          for (const [orderId, told] of ordersMine) {
            const o = e.get("staff", `/orders/${orderId}`);
            const status = o?.status;
            if (!status || status === told) continue;
            ordersMine.set(orderId, status);
            if (status === "PREPARING") fn({ kind: "order", orderId, number: o.number, status: "PREPARING" });
            if (status === "READY") fn({ kind: "order", orderId, number: o.number, status: "READY" });
            if (status === "COMPLETED" || status === "SERVED") {
              fn({ kind: "order", orderId, number: o.number, status: "SERVED" });
              ordersMine.delete(orderId);
            }
          }
        }
      });
    },
  };
}
