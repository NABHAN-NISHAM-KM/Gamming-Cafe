"use client";

import { ShieldCheck, ShieldAlert } from "lucide-react";
import { Badge, Card, ErrorNote, PageHeader, Skeleton, Table } from "@/components/ui";
import { ago, roleLabel, usePlatform } from "@/lib/client/platform";

interface Admin {
  id: string;
  email: string;
  displayName: string;
  disabled: boolean;
  lastLoginAt: string | null;
  mfa: boolean;
  roles: string[];
  since: string;
}

const ROLE_HELP: Array<[string, string]> = [
  ["Super admin", "Everything: organizations, plans, modules, cancellations."],
  ["Support", "Read everything; suspend and reactivate organizations."],
  ["Billing", "Read everything; change subscriptions and plan prices."],
  ["Readonly", "Read everything, change nothing."],
];

export default function AdminsPage() {
  const { data, error } = usePlatform<Admin[]>("/admins");
  return (
    <>
      <PageHeader eyebrow="Platform" title="Platform admins" subtitle="People who can operate ArenaOS itself. Two-step sign-in is required for all of them." />
      <ErrorNote>{error?.message}</ErrorNote>
      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          {!data ? (
            <Skeleton rows={3} />
          ) : (
            <Table head={["Admin", "Roles", "Two-step", "Last sign-in"]}>
              {data.map((a) => (
                <tr key={a.id}>
                  <td className="px-4 py-3">
                    <span className="font-medium">{a.displayName}</span>
                    <span className="block text-xs text-ink-3">{a.email}</span>
                  </td>
                  <td className="px-4 py-3"><span className="flex flex-wrap gap-1">{a.roles.map((r) => <Badge key={r} tone={r === "SUPER_ADMIN" ? "accent" : "neutral"}>{roleLabel(r)}</Badge>)}{a.disabled && <Badge tone="danger">disabled</Badge>}</span></td>
                  <td className="px-4 py-3">
                    {a.mfa ? <span className="flex items-center gap-1.5 text-ok"><ShieldCheck className="size-4" /> On</span> : <span className="flex items-center gap-1.5 text-reserved"><ShieldAlert className="size-4" /> At first sign-in</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-3">{ago(a.lastLoginAt)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        <Card className="p-5">
          <h2 className="text-base font-semibold">What each role can do</h2>
          <dl className="mt-4 grid gap-3 text-sm">
            {ROLE_HELP.map(([k, v]) => (
              <div key={k}>
                <dt className="font-medium">{k}</dt>
                <dd className="text-ink-2">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-5 border-t border-line pt-4 text-xs text-ink-3">Platform roles are granted in the database by the operator (PlatformRoleAssignment), never from this screen.</p>
        </Card>
      </div>
    </>
  );
}
