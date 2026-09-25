"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  BarChart3, Boxes, Building2, CalendarClock, ChefHat, Coins, Cpu, Gamepad2, Gauge, Joystick, LayoutGrid, LogOut,
  Megaphone, Menu, MonitorPlay, Settings, ShieldCheck, ShoppingCart, Tag, Timer, Trophy, UserRound, Users, UtensilsCrossed, X,
} from "lucide-react";
import { session } from "@/lib/client/api";
import { useApi } from "@/lib/client/hooks";
import { MeProvider, type Me } from "@/lib/client/me";
import { cx, Spinner } from "@/components/ui";

interface NavItem {
  href: string;
  label: string;
  icon: typeof Gauge;
  phase?: number; // not built yet → shown disabled with its phase
}

const NAV: Array<{ group: string; items: NavItem[] }> = [
  { group: "Operate", items: [
    { href: "/", label: "Dashboard", icon: Gauge },
    { href: "/floor", label: "Live Floor", icon: LayoutGrid },
    { href: "/sessions", label: "Sessions", icon: Timer },
    { href: "/bookings", label: "Bookings", icon: CalendarClock, phase: 6 },
    { href: "/customers", label: "Customers", icon: UserRound },
  ] },
  { group: "Gaming", items: [
    { href: "/games", label: "Games", icon: Gamepad2, phase: 5 },
    { href: "/computers", label: "Computers", icon: Cpu },
    { href: "/consoles", label: "Consoles & VR", icon: Joystick, phase: 9 },
    { href: "/tournaments", label: "Tournaments", icon: Trophy, phase: 10 },
  ] },
  { group: "Food & sales", items: [
    { href: "/restaurant", label: "Restaurant", icon: UtensilsCrossed, phase: 7 },
    { href: "/pos", label: "POS", icon: ShoppingCart, phase: 7 },
    { href: "/kitchen", label: "Kitchen", icon: ChefHat, phase: 7 },
    { href: "/inventory", label: "Inventory", icon: Boxes, phase: 8 },
  ] },
  { group: "Business", items: [
    { href: "/branches", label: "Branches & zones", icon: Building2 },
    { href: "/employees", label: "Employees", icon: Users },
    { href: "/roles", label: "Roles", icon: ShieldCheck },
    { href: "/rates", label: "Rates", icon: Tag },
    { href: "/finance", label: "Finance", icon: Coins, phase: 11 },
    { href: "/reports", label: "Reports", icon: BarChart3, phase: 11 },
    { href: "/marketing", label: "Marketing", icon: Megaphone, phase: 10 },
    { href: "/settings", label: "Settings", icon: Settings },
  ] },
];

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <nav className="flex flex-col gap-5 px-3 py-4" aria-label="Main">
      {NAV.map((g) => (
        <div key={g.group}>
          <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3">{g.group}</p>
          <ul className="grid gap-0.5">
            {g.items.map((it) => (
              <li key={it.href}>
                {it.phase ? (
                  <span className="flex cursor-not-allowed items-center gap-2.5 rounded-md px-3 py-1.5 text-sm text-ink-3/70" title={`Coming in phase ${it.phase}`}>
                    <it.icon className="size-4" />
                    {it.label}
                    <span className="ml-auto rounded border border-line px-1 font-mono text-[9px]">P{it.phase}</span>
                  </span>
                ) : (
                  <Link
                    href={it.href}
                    onClick={onNavigate}
                    className={cx(
                      "flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm transition",
                      active(it.href) ? "bg-accent-soft text-accent" : "text-ink-2 hover:bg-panel-2 hover:text-ink",
                    )}
                  >
                    <it.icon className="size-4" />
                    {it.label}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const { data: me, error } = useApi<Me>("/auth/me");
  const [menu, setMenu] = useState(false);

  useEffect(() => setMenu(false), [path]);

  if (error) {
    return (
      <div className="flex items-center gap-4 p-8 text-sm text-danger">
        {error.status === 401 ? "Redirecting to sign in…" : error.message}
        {error.status !== 401 && (
          <button onClick={() => window.location.reload()} className="rounded-md border border-line-strong px-3 py-1.5 text-ink hover:border-accent">
            Retry
          </button>
        )}
      </div>
    );
  }
  if (!me) return <Spinner label="Loading ArenaOS" />;

  const logout = async () => {
    await session("logout");
    router.replace("/login");
  };

  return (
    <MeProvider me={me}>
      <div className="flex min-h-dvh">
        <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 overflow-y-auto border-r border-line bg-panel lg:block">
          <div className="flex h-14 items-center gap-2 border-b border-line px-5 font-semibold">
            <MonitorPlay className="size-5 text-accent" /> ArenaOS
          </div>
          <Sidebar />
        </aside>

        {menu && (
          <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setMenu(false)}>
            <aside className="h-full w-64 overflow-y-auto border-r border-line bg-panel" onClick={(e) => e.stopPropagation()}>
              <div className="flex h-14 items-center justify-between border-b border-line px-5 font-semibold">
                <span className="flex items-center gap-2"><MonitorPlay className="size-5 text-accent" /> ArenaOS</span>
                <button onClick={() => setMenu(false)} aria-label="Close menu"><X className="size-5" /></button>
              </div>
              <Sidebar onNavigate={() => setMenu(false)} />
            </aside>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-bg/85 px-4 backdrop-blur lg:px-8">
            <button className="lg:hidden" onClick={() => setMenu(true)} aria-label="Open menu"><Menu className="size-5" /></button>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{me.organization.displayName}</p>
              <p className="truncate text-[11px] text-ink-3">{me.grants.map((g) => g.role.replace(/_/g, " ")).join(" · ")}</p>
            </div>
            <div className="ml-auto flex items-center gap-3">
              {!me.user.mfaEnabled && (
                <Link href="/settings" className="hidden rounded-full border border-reserved/40 bg-reserved/10 px-2.5 py-1 text-[11px] text-reserved sm:inline">
                  Enable 2-step sign-in
                </Link>
              )}
              <div className="hidden text-right sm:block">
                <p className="text-sm">{me.employee.displayName}</p>
                <p className="text-[11px] text-ink-3">{me.user.email}</p>
              </div>
              <button onClick={logout} className="rounded-md p-2 text-ink-3 hover:bg-panel-2 hover:text-ink" aria-label="Sign out" title="Sign out">
                <LogOut className="size-4" />
              </button>
            </div>
          </header>
          <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 lg:px-8">{children}</main>
        </div>
      </div>
    </MeProvider>
  );
}

