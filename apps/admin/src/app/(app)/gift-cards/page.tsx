"use client";

import { useRef, useState } from "react";
import { Copy, Gift, Printer } from "lucide-react";
import { api } from "@/lib/client/api";
import { useBranch } from "@/lib/client/branch";
import { useAction, useApi } from "@/lib/client/hooks";
import { useCan } from "@/lib/client/me";
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, PageHeader, Select, Spinner, Table, toast } from "@/components/ui";

interface Cards {
  outstanding: { count: number; amount: string };
  cards: Array<{ id: string; codeHint: string; amount: string; currency: string; status: "ACTIVE" | "REDEEMED"; createdAt: string; redeemedAt: string | null; redeemedBy: { displayName: string; username: string | null } | null }>;
}
interface Sold { code: string; amount: string; currency: string; billNumber: string }

const PRESETS = ["25", "50", "100"];

/**
 * Gift cards: sell one at the counter, hand over the code. The code is shown
 * once (only its hash is kept), so the page prints or copies it right away.
 */
export default function GiftCardsPage() {
  const can = useCan();
  const { branches, branchId, setBranchId } = useBranch();
  const list = useApi<Cards>("/gift-cards");
  const [amount, setAmount] = useState("50");
  const [method, setMethod] = useState<"CASH" | "CARD">("CASH");
  const [sold, setSold] = useState<Sold | null>(null);
  const attempt = useRef(crypto.randomUUID()); // one key per card, so a double click can't sell two
  const maySell = can("wallet.topup", branchId ?? undefined);

  const sell = useAction(async () => {
    const r = await api<Sold & { duplicate?: boolean }>("/gift-cards", { method: "POST", body: { branchId, amount, payment: { method }, idempotencyKey: attempt.current } });
    attempt.current = crypto.randomUUID();
    if (r.duplicate) return toast("That sale already went through. Its code can't be shown again.", "warn");
    setSold(r);
    void list.reload();
  });
  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      toast("Code copied.");
    } catch {
      toast("Couldn't copy: select the code and copy it by hand.", "warn");
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Gift cards"
        subtitle="Sell a prepaid code at the counter. The player enters it in the app and the money lands in their wallet."
        actions={branches.data && branches.data.length > 1 && (
          <Select value={branchId ?? ""} onChange={(e) => setBranchId(e.target.value)} className="w-auto">
            {branches.data.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
          </Select>
        )}
      />
      <ErrorNote>{sell.error}</ErrorNote>
      {sold && (
        <Card className="space-y-3 border-ok p-5 print:border-0">
          <p className="text-sm text-ink-2">Gift card sold · {sold.currency} {sold.amount} · bill {sold.billNumber}. <b>This is the only time the code is shown.</b></p>
          <p className="select-all font-mono text-3xl font-semibold tracking-wider" data-testid="gift-code">{sold.code}</p>
          <div className="flex gap-2 print:hidden">
            <Button size="sm" variant="secondary" onClick={() => void copy(sold.code)}><Copy className="size-3.5" /> Copy</Button>
            <Button size="sm" variant="secondary" onClick={() => window.print()}><Printer className="size-3.5" /> Print</Button>
            <Button size="sm" variant="ghost" onClick={() => setSold(null)}>Done</Button>
          </div>
        </Card>
      )}
      {maySell && (
        <Card className="p-5 print:hidden">
          <form className="grid items-end gap-3 sm:grid-cols-[2fr_1fr_auto]" onSubmit={(e) => { e.preventDefault(); void sell.run(); }}>
            <Field label="Amount">
              <div className="flex gap-2">
                <Input type="number" min={1} max={5000} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
                {PRESETS.map((p) => <Button key={p} type="button" size="sm" variant={amount === p ? "primary" : "secondary"} onClick={() => setAmount(p)}>{p}</Button>)}
              </div>
            </Field>
            <Field label="Paid by">
              <Select value={method} onChange={(e) => setMethod(e.target.value as "CASH" | "CARD")}>
                <option value="CASH">Cash</option>
                <option value="CARD">Card</option>
              </Select>
            </Field>
            <Button type="submit" pending={sell.pending} disabled={!branchId}><Gift className="size-4" /> Sell card</Button>
          </form>
        </Card>
      )}
      <Card className="print:hidden">
        {!list.data ? (
          <Spinner />
        ) : (
          <>
            <p className="px-4 pt-4 text-sm text-ink-2">Still to be redeemed: <b>{list.data.outstanding.count}</b> cards · <b>{list.data.outstanding.amount}</b></p>
            {list.data.cards.length === 0 ? (
              <Empty icon={<Gift className="size-8" />} title="No gift cards yet">Cards you sell show up here, by their last four characters.</Empty>
            ) : (
              <Table head={["Card", "Amount", "Sold", "Status", "Redeemed by"]}>
                {list.data.cards.map((c) => (
                  <tr key={c.id} className="border-t border-line">
                    <td className="px-4 py-2 font-mono">···· {c.codeHint}</td>
                    <td className="px-4 py-2 tabular-nums">{c.currency} {c.amount}</td>
                    <td className="px-4 py-2 text-ink-3">{new Date(c.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-2">{c.status === "ACTIVE" ? <Badge tone="warn">unused</Badge> : <Badge tone="ok">redeemed</Badge>}</td>
                    <td className="px-4 py-2 text-ink-2">{c.redeemedBy ? `${c.redeemedBy.displayName}${c.redeemedBy.username ? ` (@${c.redeemedBy.username})` : ""}` : "—"}</td>
                  </tr>
                ))}
              </Table>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
