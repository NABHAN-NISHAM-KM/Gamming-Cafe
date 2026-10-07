"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Activity, BarChart3, Building2, FileText, Gauge, Inbox, User, Layers, LogOut, Megaphone, Menu, Rocket, ScrollText, Search, Settings as SettingsIcon, ShieldCheck, X } from "lucide-react";
import { platformApi, platformSession, roleLabel, usePlatform, type PlatformMe } from "@/lib/client/platform";
import { PlatformMeProvider } from "@/lib/client/platform-me";
import { cx, Kbd } from "@/components/ui";
import { CommandPalette, type Command } from "@/components/command";

const GROUPS = [
  { group: "", items: [{ href: "/platform", label: "Overview", icon: Gauge }] },
  { group: "Venues", items: [
    { href: "/platform/organizations", label: "Organizations", icon: Building2 },
    { href: "/platform/health", label: "Venue health", icon: Activity },
    { href: "/platform/leads", label: "Leads", icon: Inbox },
  ] },
  { group: "Product", items: [
    { href: "/platform/releases", label: "Releases", icon: Rocket },
    { href: "/platform/announcements", label: "Announcements", icon: Megaphone },
    { href: "/platform/plans", label: "Plans & features", icon: Layers },
    { href: "/platform/site", label: "Website", icon: BarChart3 },
  ] },
  { group: "Setup & security", items: [
    { href: "/platform/settings", label: "Settings", icon: SettingsIcon },
    { href: "/platform/audit", label: "Audit log", icon: ScrollText },
    { href: "/platform/admins", label: "Platform admins", icon: ShieldCheck },
  ] },
];
const NAV = GROUPS.flatMap((g) => g.items);

const isActive = (path: string, href: string) => (href === "/platform" ? path === "/platform" : path.startsWith(href));

function Mark() {
  return (
    <span className="flex items-center gap-2.5">
      <span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-accent-2 to-accent text-sm font-bold text-accent-ink shadow-[0_0_20px_-4px_var(--color-accent-2)]">A</span>
      <span className="leading-none">
        <span className="block font-display text-[17px] font-bold tracking-wide">
          Arena<span className="text-accent">OS</span>
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-accent-2">Platform</span>
      </span>
    </span>
  );
}

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <nav className="grid gap-4 px-3 py-5" aria-label="Platform">
      {GROUPS.map((g) => (
        <div key={g.group || "top"}>
          {g.group && <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-3">{g.group}</p>}
          <div className="grid gap-0.5">
            {g.items.map((it) => {
              const on = isActive(path, it.href);
              return (
                <Link
                  key={it.href}
                  href={it.href}
                  onClick={onNavigate}
                  aria-current={on ? "page" : undefined}
                  className={cx("group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors", on ? "bg-accent-soft font-medium text-ink" : "text-ink-2 hover:bg-panel-2 hover:text-ink")}
                >
                  {on && <span className="absolute inset-y-1.5 -left-3 w-1 rounded-r-full bg-accent-2 shadow-[0_0_12px_var(--color-accent-2)]" aria-hidden />}
                  <it.icon className={cx("size-4", on ? "text-accent-2" : "text-ink-3 group-hover:text-ink-2")} />
                  {it.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

export default function PlatformLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const { data: me, error } = usePlatform<PlatformMe>("/auth/me");
  const [menu, setMenu] = useState(false);
  const [palette, setPalette] = useState(false);

  useEffect(() => setMenu(false), [path]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  const logout = async () => {
    await platformSession("logout");
    router.replace("/login");
  };
  const commands = useMemo<Command[]>(
    () => [
      ...NAV.map((n) => ({ id: n.href, label: n.label, group: "Platform", icon: n.icon, href: n.href })),
      { id: "new-org", label: "New organization", group: "Actions", icon: Building2, href: "/platform/organizations?new=1", keywords: "create onboard tenant" },
      { id: "logout", label: "Sign out", group: "Account", icon: LogOut, run: () => void logout(), keywords: "logout exit" },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Venues, people, leads and invoices by what you type (the palette's server-side half).
  const lookup = useMemo(() => async (q: string): Promise<Command[]> => {
    const r = await platformApi<{ results: Array<{ kind: string; label: string; sub: string; href: string }> }>(`/search?q=${encodeURIComponent(q)}`);
    const icon = { Venue: Building2, Person: User, Lead: Inbox, Invoice: FileText } as const;
    return r.results.map((x, i) => ({ id: `found-${i}`, label: `${x.label} — ${x.sub}`, group: x.kind, icon: icon[x.kind as keyof typeof icon] ?? Building2, href: x.href }));
  }, []);

  if (error) {
    return (
      <div className="grid min-h-dvh place-items-center p-8 text-center text-sm">
        <div className="grid gap-3">
          <p className="text-danger">{error.status === 401 ? "Redirecting to sign in…" : error.message}</p>
          {error.status !== 401 && (
            <button onClick={() => window.location.reload()} className="press mx-auto rounded-lg border border-line-strong px-4 py-2 hover:border-accent">
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }
  if (!me) {
    return (
      <div className="grid min-h-dvh place-items-center" role="status">
        <div className="flex flex-col items-center gap-4">
          <span className="size-10 animate-pulse rounded-xl bg-gradient-to-br from-accent-2 to-accent shadow-glow" />
          <span className="text-sm text-ink-3">Loading platform…</span>
        </div>
      </div>
    );
  }

  const here = NAV.find((n) => isActive(path, n.href))?.label ?? "Overview";
  const initials = me.user.displayName.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  return (
    <PlatformMeProvider me={me}>
      <div className="flex min-h-dvh">
        <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-line bg-panel/80 backdrop-blur lg:flex">
          <div className="flex h-16 items-center border-b border-line px-5">
            <Mark />
          </div>
          <div className="px-3 pt-4">
            <button onClick={() => setPalette(true)} className="press flex h-9 w-full items-center gap-2 rounded-lg border border-line bg-bg/60 px-3 text-sm text-ink-3 hover:border-line-strong hover:text-ink-2">
              <Search className="size-4" /> Search
              <span className="ml-auto flex gap-1"><Kbd>Ctrl</Kbd><Kbd>K</Kbd></span>
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <Nav />
          </div>
          <div className="border-t border-line p-3">
            <div className="flex items-center gap-3 rounded-lg px-2 py-1.5">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-raised font-display text-xs font-bold text-accent-2 ring-1 ring-line-strong">{initials}</span>
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate text-sm font-medium">{me.user.displayName}</p>
                <p className="truncate text-[11px] text-ink-3">{me.user.email}</p>
              </div>
              <button onClick={logout} className="press rounded-lg p-2 text-ink-3 hover:bg-panel-2 hover:text-danger" aria-label="Sign out" title="Sign out">
                <LogOut className="size-4" />
              </button>
            </div>
          </div>
        </aside>

        <div className={cx("fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity lg:hidden", menu ? "opacity-100" : "pointer-events-none opacity-0")} onClick={() => setMenu(false)} aria-hidden={!menu}>
          <aside className={cx("h-full w-72 overflow-y-auto border-r border-line bg-panel shadow-2xl transition-transform duration-300", menu ? "translate-x-0" : "-translate-x-full")} onClick={(e) => e.stopPropagation()}>
            <div className="flex h-16 items-center justify-between border-b border-line px-5">
              <Mark />
              <button onClick={() => setMenu(false)} className="press rounded-lg p-2 hover:bg-panel-2" aria-label="Close menu"><X className="size-5" /></button>
            </div>
            <Nav onNavigate={() => setMenu(false)} />
          </aside>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-bg/75 px-4 backdrop-blur-xl lg:px-8">
            <button className="press -ml-1 rounded-lg p-2 hover:bg-panel-2 lg:hidden" onClick={() => setMenu(true)} aria-label="Open menu"><Menu className="size-5" /></button>
            <div className="min-w-0">
              <p className="truncate text-[11px] uppercase tracking-[0.14em] text-ink-3">ArenaOS platform</p>
              <p className="truncate font-display text-base font-semibold">{here}</p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button onClick={() => setPalette(true)} className="press rounded-lg p-2 text-ink-3 hover:bg-panel-2 hover:text-ink lg:hidden" aria-label="Search"><Search className="size-5" /></button>
              {me.roles.map((r) => (
                <span key={r} className="hidden rounded-full border border-accent-2/40 bg-accent-2/10 px-3 py-1 text-[11px] font-semibold text-accent-2 sm:inline">
                  {roleLabel(r)}
                </span>
              ))}
            </div>
          </header>
          <main key={path} className="animate-enter mx-auto w-full max-w-7xl flex-1 px-4 py-8 lg:px-8">
            {children}
          </main>
        </div>
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} commands={commands} search={lookup} />
    </PlatformMeProvider>
  );
}
