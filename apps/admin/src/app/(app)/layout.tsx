"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  BarChart3, Boxes, Building2, CalendarClock, ChefHat, ChevronDown, Coins, Cpu, Gamepad2, Gauge, Joystick, LayoutGrid, LogOut, MonitorPlay,
  Megaphone, Menu, Printer, ReceiptText, Search, Settings, ShieldAlert, ShieldCheck, ShoppingCart, Tag, Timer, Trophy, Truck, UserRound, Users, UtensilsCrossed, X,
} from "lucide-react";
import { session } from "@/lib/client/api";
import { useApi } from "@/lib/client/hooks";
import { MeProvider, type Me } from "@/lib/client/me";
import { cx, Kbd } from "@/components/ui";
import { CommandPalette, type Command } from "@/components/command";
import { LiveNotices } from "@/components/live-notices";
import { StaffBar } from "@/components/staff-bar";
import { applyDir, useLang, useT, type TKey } from "@/lib/client/i18n";

interface NavItem {
  href: string;
  label: string;
  icon: typeof Gauge;
  phase?: number; // not built yet → shown disabled with its phase
  /** Shown if the user holds any of these (the permission the page's data needs). Omitted = everyone. */
  anyOf?: string[];
  /** Kept in the short menu counter staff see by default. */
  everyday?: boolean;
}

const NAV: Array<{ group: string; items: NavItem[] }> = [
  { group: "Operate", items: [
    { href: "/counter", label: "Counter", icon: MonitorPlay, anyOf: ["station.start_session", "pos.sell"], everyday: true },
    { href: "/", label: "Dashboard", icon: Gauge, everyday: true },
    { href: "/floor", label: "Live Floor", icon: LayoutGrid, anyOf: ["station.view"], everyday: true },
    { href: "/sessions", label: "Sessions", icon: Timer, anyOf: ["station.view"] },
    { href: "/bookings", label: "Bookings", icon: CalendarClock, anyOf: ["booking.view"], everyday: true },
    { href: "/customers", label: "Customers", icon: UserRound, anyOf: ["customer.view"], everyday: true },
    { href: "/printing", label: "Printing", icon: Printer, anyOf: ["print.view"] },
  ] },
  { group: "Gaming", items: [
    { href: "/games", label: "Games", icon: Gamepad2, anyOf: ["game.view"] },
    { href: "/computers", label: "Computers", icon: Cpu, anyOf: ["station.view"] },
    { href: "/consoles", label: "Consoles & VR", icon: Joystick, anyOf: ["station.view"] },
    { href: "/tournaments", label: "Tournaments", icon: Trophy, anyOf: ["tournament.view"] },
  ] },
  { group: "Food & sales", items: [
    { href: "/restaurant", label: "Restaurant", icon: UtensilsCrossed, anyOf: ["restaurant.order", "restaurant.menu_manage"] },
    { href: "/pos", label: "POS", icon: ShoppingCart, anyOf: ["pos.sell"], everyday: true },
    { href: "/orders", label: "Orders", icon: ReceiptText, anyOf: ["pos.sell"], everyday: true },
    { href: "/kitchen", label: "Kitchen", icon: ChefHat, anyOf: ["kds.view"], everyday: true },
    { href: "/inventory", label: "Inventory", icon: Boxes, anyOf: ["inventory.view"] },
    { href: "/purchasing", label: "Purchasing", icon: Truck, anyOf: ["purchasing.view"] },
  ] },
  { group: "Business", items: [
    { href: "/branches", label: "Branches & zones", icon: Building2, anyOf: ["branch.view"] },
    { href: "/employees", label: "Employees", icon: Users, anyOf: ["employee.view"] },
    { href: "/roles", label: "Roles", icon: ShieldCheck, anyOf: ["employee.view"] },
    { href: "/rates", label: "Rates", icon: Tag, anyOf: ["pricing.view"] },
    { href: "/finance", label: "Finance", icon: Coins, anyOf: ["accounting.view"] },
    { href: "/reports", label: "Reports", icon: BarChart3, anyOf: ["reports.operational", "reports.financial", "reports.staff"] },
    { href: "/marketing", label: "Marketing", icon: Megaphone, anyOf: ["promotion.view", "loyalty.view", "crm.view"] },
    { href: "/settings", label: "Settings", icon: Settings, everyday: true },
  ] },
];

/** The menu for this user: items they can't use are left out, and empty groups disappear. `short`: the everyday items only. */
const navFor = (me: Me, short = false) => {
  const held = new Set(me.grants.flatMap((g) => g.permissions));
  return NAV.map((g) => ({ ...g, items: g.items.filter((it) => (!it.anyOf || it.anyOf.some((p) => held.has(p))) && (!short || it.everyday)) })).filter((g) => g.items.length);
};

const SHORT_KEY = "arena.shortMenu";
/** Counter staff (no organization-wide role) start with the short menu; anyone can switch, remembered in this browser. */
function useShortMenu(me: Me | undefined) {
  const [short, setShort] = useState<boolean | null>(null);
  useEffect(() => {
    if (!me || short !== null) return;
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(SHORT_KEY);
    } catch {
      /* storage unavailable */
    }
    setShort(saved === null ? !me.grants.some((g) => g.scope === "ORGANIZATION") : saved === "1");
  }, [me, short]);
  const toggle = () =>
    setShort((v) => {
      try {
        localStorage.setItem(SHORT_KEY, v ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !v;
    });
  return [!!short, toggle] as const;
}

const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path.startsWith(href));

function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cx("flex items-center gap-2.5 font-display text-[17px] font-bold tracking-wide", className)}>
      <span className="brand-gradient grid size-8 place-items-center rounded-lg text-sm font-bold text-accent-ink shadow-[0_0_20px_-4px_var(--color-accent)]">A</span>
      Arena<span className="-ml-2 text-accent">OS</span>
    </span>
  );
}

function Sidebar({ nav, onNavigate, short, onToggleShort }: { nav: typeof NAV; onNavigate?: () => void; short: boolean; onToggleShort: () => void }) {
  const path = usePathname();
  const t = useT();
  return (
    <nav className="flex flex-col gap-6 px-3 py-5" aria-label="Main">
      {nav.map((g) => (
        <div key={g.group}>
          <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-3">{t(`nav.${g.group}` as TKey)}</p>
          <ul className="grid gap-0.5">
            {g.items.map((it) => {
              const on = isActive(path, it.href);
              return (
                <li key={it.href}>
                  {it.phase ? (
                    <span className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-sm text-ink-3/70" title={`Coming in phase ${it.phase}`}>
                      <it.icon className="size-4" />
                      {it.label}
                      <span className="ml-auto rounded border border-line px-1 font-mono text-[9px]">P{it.phase}</span>
                    </span>
                  ) : (
                    <Link
                      href={it.href}
                      onClick={onNavigate}
                      aria-current={on ? "page" : undefined}
                      className={cx(
                        "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-150",
                        on ? "bg-accent-soft font-medium text-ink" : "text-ink-2 hover:bg-panel-2 hover:text-ink",
                      )}
                    >
                      {on && <span className="absolute inset-y-1.5 -left-3 w-1 rounded-r-full bg-accent shadow-[0_0_12px_var(--color-accent)] rtl:-right-3 rtl:left-auto rtl:rounded-l-full rtl:rounded-r-none" aria-hidden />}
                      <it.icon className={cx("size-4 transition-colors", on ? "text-accent" : "text-ink-3 group-hover:text-ink-2")} />
                      {t(`nav.${it.label}` as TKey)}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <button onClick={onToggleShort} className="press flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-ink-3 hover:bg-panel-2 hover:text-ink">
        <ChevronDown className={cx("size-3.5 transition-transform", !short && "rotate-180")} /> {short ? t("nav.more") : t("nav.less")}
      </button>
    </nav>
  );
}

function pageTitle(path: string) {
  for (const g of NAV) for (const it of g.items) if (it.href !== "/" && path.startsWith(it.href)) return { group: g.group, label: it.label };
  return { group: "Operate", label: "Dashboard" };
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const { data: me, error } = useApi<Me>("/auth/me");
  const [menu, setMenu] = useState(false);
  const [palette, setPalette] = useState(false);
  const [short, toggleShort] = useShortMenu(me);
  const lang = useLang();
  const t = useT();
  useEffect(() => applyDir(lang), [lang]);

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
    await session("logout");
    router.replace("/login");
  };

  const nav = useMemo(() => (me ? navFor(me, short) : []), [me, short]);
  const allNav = useMemo(() => (me ? navFor(me) : []), [me]);
  const commands = useMemo<Command[]>(
    () => [
      ...allNav.flatMap((g) => g.items.filter((it) => !it.phase).map((it) => ({ id: it.href, label: it.label, group: g.group, icon: it.icon, href: it.href }))),
      { id: "logout", label: "Sign out", group: "Account", icon: LogOut, run: () => void logout(), keywords: "logout exit" },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allNav],
  );

  if (error) {
    return (
      <div className="flex items-center gap-4 p-8 text-sm text-danger">
        {error.status === 401 ? "Redirecting to sign in…" : error.message}
        {error.status !== 401 && (
          <button onClick={() => window.location.reload()} className="press rounded-lg border border-line-strong px-3 py-1.5 text-ink hover:border-accent">
            Retry
          </button>
        )}
      </div>
    );
  }
  if (!me) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <div className="flex flex-col items-center gap-4" role="status">
          <span className="brand-gradient size-10 animate-pulse rounded-xl shadow-glow" />
          <span className="text-sm text-ink-3">Loading ArenaOS…</span>
        </div>
      </div>
    );
  }

  const here = pageTitle(path);
  const initials = me.employee.displayName.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  return (
    <MeProvider me={me}>
      <div className="flex min-h-dvh">
        <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-line bg-panel/80 backdrop-blur lg:flex">
          <div className="flex h-16 items-center border-b border-line px-5">
            <BrandMark />
          </div>
          <div className="px-3 pt-4">
            <button
              onClick={() => setPalette(true)}
              className="press flex h-9 w-full items-center gap-2 rounded-lg border border-line bg-bg/60 px-3 text-sm text-ink-3 hover:border-line-strong hover:text-ink-2"
            >
              <Search className="size-4" /> {t("nav.search")}
              <span className="ml-auto flex gap-1"><Kbd>Ctrl</Kbd><Kbd>K</Kbd></span>
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <Sidebar nav={nav} short={short} onToggleShort={toggleShort} />
          </div>
          <div className="border-t border-line p-3">
            <div className="flex items-center gap-3 rounded-lg px-2 py-1.5">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-raised font-display text-xs font-bold text-accent ring-1 ring-line-strong">{initials}</span>
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate text-sm font-medium">{me.employee.displayName}</p>
                <p className="truncate text-[11px] text-ink-3">{me.user.email}</p>
              </div>
              <button onClick={logout} className="press rounded-lg p-2 text-ink-3 hover:bg-panel-2 hover:text-danger" aria-label="Sign out" title="Sign out">
                <LogOut className="size-4" />
              </button>
            </div>
          </div>
        </aside>

        {/* Mobile drawer */}
        <div
          className={cx("fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-200 lg:hidden", menu ? "opacity-100" : "pointer-events-none opacity-0")}
          onClick={() => setMenu(false)}
          aria-hidden={!menu}
        >
          <aside
            className={cx("h-full w-72 overflow-y-auto border-r border-line bg-panel shadow-2xl transition-transform duration-300 ease-out", menu ? "translate-x-0" : "-translate-x-full")}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex h-16 items-center justify-between border-b border-line px-5">
              <BrandMark />
              <button onClick={() => setMenu(false)} className="press rounded-lg p-2 hover:bg-panel-2" aria-label="Close menu"><X className="size-5" /></button>
            </div>
            <Sidebar nav={nav} short={short} onToggleShort={toggleShort} onNavigate={() => setMenu(false)} />
          </aside>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-bg/75 px-4 backdrop-blur-xl lg:px-8">
            <button className="press -ml-1 rounded-lg p-2 hover:bg-panel-2 lg:hidden" onClick={() => setMenu(true)} aria-label="Open menu"><Menu className="size-5" /></button>
            <div className="min-w-0">
              <p className="truncate text-[11px] uppercase tracking-[0.14em] text-ink-3">
                {me.organization.displayName} <span className="text-line-strong">/</span> {here.group}
              </p>
              <p className="truncate font-display text-base font-semibold">{t(`nav.${here.label}` as TKey)}</p>
            </div>
            <div className="ml-auto flex items-center gap-1.5 rtl:ml-0 rtl:mr-auto">
              <StaffBar />
              {!me.user.mfaEnabled && (
                <Link href="/settings" className="press hidden items-center gap-1.5 rounded-full border border-reserved/40 bg-reserved/10 px-3 py-1 text-[11px] font-medium text-reserved hover:bg-reserved/15 sm:flex">
                  <ShieldAlert className="size-3.5" /> Enable 2-step sign-in
                </Link>
              )}
              <button onClick={() => setPalette(true)} className="press rounded-lg p-2 text-ink-3 hover:bg-panel-2 hover:text-ink lg:hidden" aria-label="Search">
                <Search className="size-5" />
              </button>
              <span className="hidden max-w-64 truncate rounded-full border border-line bg-panel px-3 py-1 text-[11px] capitalize text-ink-2 md:inline" title="Your roles">
                {me.grants.map((g) => g.role.replace(/_/g, " ").toLowerCase()).join(" · ")}
              </span>
            </div>
          </header>
          <main key={path} className="animate-enter mx-auto w-full max-w-7xl flex-1 px-4 py-8 lg:px-8">
            {children}
          </main>
        </div>
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} commands={commands} />
      <LiveNotices />
    </MeProvider>
  );
}
