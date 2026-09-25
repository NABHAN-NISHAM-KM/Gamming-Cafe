"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Timer } from "lucide-react";
import { useApi } from "@/lib/client/hooks";
import { useBranch } from "@/lib/client/branch";
import { fmtCountdown, remaining, setServerTime, useTick, type SessionView } from "@/lib/client/sessions";
import type { Branch } from "@/lib/client/types";
import { Badge, Card, Empty, ErrorNote, PageHeader, Select, Spinner, Table, cx } from "@/components/ui";

const END_LABEL: Record<string, string> = { EXPIRED: "Time up", STAFF_ENDED: "Ended by staff", CUSTOMER_LOGOUT: "Customer logged out", MOVED: "Moved", DEVICE_FAILURE: "PC failure", ADMIN_FORCE: "Forced" };

export default function SessionsPage() {
  useTick();
  const { branches, branchId, setBranchId } = useBranch();
  const [tab, setTab] = useState<"live" | "recent">("live");
  const list = useApi<SessionView[]>(branchId ? `/branches/${branchId}/sessions?state=${tab}` : null);
  useEffect(() => {
    if (list.data?.[0]) setServerTime((list.data[0] as SessionView & { serverTime: string }).serverTime);
  }, [list.data]);
  useEffect(() => {
    const t = setInterval(() => void list.reload(), 10_000);
    return () => clearInterval(t);
  }, [list.reload]);

  return (
    <>
      <PageHeader
        title="Sessions"
        subtitle="Who is playing where, how long they have left, and what they paid."
        actions={
          branches.data && branches.data.length > 1 && (
            <Select value={branchId ?? ""} onChange={(e) => setBranchId(e.target.value)} className="w-auto">
              {branches.data.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code} · {b.name}
                </option>
              ))}
            </Select>
          )
        }
      />
      <div className="mb-4 flex gap-1">
        {(["live", "recent"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cx("rounded-md px-3 py-1.5 text-sm", tab === t ? "bg-accent-soft text-accent" : "text-ink-2 hover:bg-panel-2")}>
            {t === "live" ? "Live now" : "Recent"}
          </button>
        ))}
      </div>
      <Card>
        {list.loading && !list.data ? (
          <Spinner />
        ) : list.error ? (
          <div className="p-5">
            <ErrorNote>{list.error.message}</ErrorNote>
          </div>
        ) : !list.data?.length ? (
          <Empty icon={<Timer className="size-8" />} title={tab === "live" ? "Nobody is playing right now" : "No finished sessions yet"}>
            {tab === "live" && (
              <>
                Start one from the{" "}
                <Link href="/floor" className="text-accent">
                  Live Floor
                </Link>{" "}
                — click a green station.
              </>
            )}
          </Empty>
        ) : (
          <Table head={tab === "live" ? ["Station", "Customer", "Rate", "Time left", "Paid", "Bill"] : ["Station", "Customer", "Rate", "Started", "Ended", "Amount"]}>
            {list.data.map((s) => {
              const ms = remaining(s.expiresAt);
              return (
                <tr key={s.id} className="hover:bg-panel-2">
                  <td className="px-4 py-3 font-medium">{s.deviceName}</td>
                  <td className="px-4 py-3">{s.customer?.displayName ?? <span className="text-ink-3">{s.guestLabel ?? "Guest"}</span>}</td>
                  <td className="px-4 py-3 text-ink-2">{s.planName}</td>
                  {tab === "live" ? (
                    <>
                      <td className={cx("tabular px-4 py-3 font-mono", ms !== null && ms < 5 * 60_000 && "text-ending")}>{s.expiresAt ? fmtCountdown(ms) : "open"}</td>
                      <td className="tabular px-4 py-3">{s.paymentTiming === "POSTPAID" ? <Badge tone="warn">pay later</Badge> : `${s.currency} ${s.amountDue}`}</td>
                      <td className="px-4 py-3 font-mono text-xs text-ink-3">{s.bill?.number}</td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-3 text-xs text-ink-2">{s.startedAt ? new Date(s.startedAt).toLocaleString() : "—"}</td>
                      <td className="px-4 py-3 text-xs">
                        {s.endedAt ? new Date(s.endedAt).toLocaleTimeString() : "—"} <span className="text-ink-3">· {END_LABEL[s.endReason ?? ""] ?? s.endReason}</span>
                      </td>
                      <td className="tabular px-4 py-3">
                        {s.currency} {s.amountDue}
                        {s.bill && s.bill.status !== "SETTLED" && <Badge tone="warn">unpaid</Badge>}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
    </>
  );
}
