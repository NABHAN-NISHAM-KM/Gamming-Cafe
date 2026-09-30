"use client";

import { useState } from "react";
import { Card, cx, ErrorNote, PageHeader } from "@/components/ui";
import { ActivityList, SectionTitle } from "@/components/platform";
import { usePlatform, type AuditRow } from "@/lib/client/platform";

export default function AuditPage() {
  const [scope, setScope] = useState<"platform" | "all">("all");
  const { data, error } = usePlatform<AuditRow[]>(`/audit?scope=${scope}`);
  return (
    <>
      <PageHeader eyebrow="Platform" title="Audit log" subtitle="Tamper-evident: every row is hash-chained in the database and can't be edited or deleted." />
      <ErrorNote>{error?.message}</ErrorNote>
      <Card>
        <SectionTitle
          action={
            <div className="flex gap-1.5" role="group" aria-label="Scope">
              {(["all", "platform"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setScope(s)}
                  aria-pressed={scope === s}
                  className={cx("press rounded-full border px-3 py-1 text-xs font-medium", scope === s ? "border-accent bg-accent text-accent-ink" : "border-line-strong text-ink-2 hover:text-ink")}
                >
                  {s === "platform" ? "Platform admins" : "Everyone"}
                </button>
              ))}
            </div>
          }
        >
          Latest 100 events
        </SectionTitle>
        <ActivityList rows={data} empty="No events yet." />
      </Card>
    </>
  );
}
