"use client";

import Link from "next/link";
import { CircleDollarSign, MonitorPlay, Plus, ShoppingCart } from "lucide-react";
import { useBranch } from "@/lib/client/branch";
import { useCan } from "@/lib/client/me";
import { useT, type TKey } from "@/lib/client/i18n";
import { CounterBoard } from "@/components/counter-board";
import { Select, Spinner, cx } from "@/components/ui";

const ACTIONS: Array<{ key: "start" | "add" | "sell" | "pay"; href: string; icon: typeof Plus; perm: string; tone: string }> = [
  { key: "start", href: "/floor?show=free", icon: MonitorPlay, perm: "station.start_session", tone: "border-ok/50 bg-ok/10 text-ok" },
  { key: "add", href: "/floor?show=busy", icon: Plus, perm: "station.extend_session", tone: "border-busy/50 bg-busy/10 text-busy" },
  { key: "sell", href: "/pos", icon: ShoppingCart, perm: "pos.sell", tone: "border-accent/50 bg-accent/10 text-accent" },
  { key: "pay", href: "/orders?open=1", icon: CircleDollarSign, perm: "pos.sell", tone: "border-reserved/50 bg-reserved/10 text-reserved" },
];

/** Home for counter staff: four big buttons for the everyday jobs, then what needs doing now. */
export default function CounterPage() {
  const t = useT();
  const can = useCan();
  const { branches, branchId, setBranchId } = useBranch();
  if (!branchId) return <Spinner />;
  const actions = ACTIONS.filter((a) => can(a.perm, branchId));
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("counter.title")}</h1>
          <p className="text-sm text-ink-3">{t("counter.subtitle")}</p>
        </div>
        {branches.data && branches.data.length > 1 && (
          <Select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="w-auto" aria-label="Branch">
            {branches.data.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
          </Select>
        )}
      </header>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {actions.map((a) => (
          <Link key={a.key} href={a.href} className={cx("press group flex min-h-36 flex-col justify-between rounded-2xl border-2 p-5 transition hover:-translate-y-0.5", a.tone)}>
            <a.icon className="size-9" aria-hidden />
            <span>
              <span className="block text-lg font-semibold text-ink">{t(`counter.${a.key}` as TKey)}</span>
              <span className="block text-xs text-ink-2">{t(`counter.${a.key}.hint` as TKey)}</span>
            </span>
          </Link>
        ))}
      </div>
      <CounterBoard branchId={branchId} />
    </div>
  );
}
