"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/client/api";

interface Receipt {
  venue: { name: string; legalName: string; taxNumber: string | null; branch: string; address: string | null; phone: string | null };
  bill: { number: string; status: string; openedAt: string; closedAt: string | null; table: string | null; customer: string | null; currency: string };
  items: Array<{ order: string; name: string; quantity: number; unitPrice: string; discount: string; tax: string; total: string }>;
  play: Array<{ station: string | null; startedAt: string | null; endedAt: string | null; minutes: number }>;
  totals: { subtotal: string; discount: string; tax: string; tip: string; total: string; paid: string; due: string };
  payments: Array<{ method: string; amount: string; at: string | null; refunded: boolean }>;
}

/** A full A4 receipt for a bill (tax number, every line, payments), printed from the browser. */
function ReceiptView() {
  const billId = useSearchParams().get("bill");
  const [r, setR] = useState<Receipt | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (billId) api<Receipt>(`/bills/${billId}/receipt`).then(setR, (e: Error) => setErr(e.message));
  }, [billId]);
  if (err) return <p className="p-8 text-danger">{err}</p>;
  if (!r) return <p className="p-8">Loading…</p>;
  const money = (v: string) => `${v} ${r.bill.currency}`;
  return (
    <main className="mx-auto max-w-2xl bg-white p-10 text-black print:p-0">
      <header className="mb-6 border-b border-black/20 pb-4">
        <h1 className="text-2xl font-bold">{r.venue.name}</h1>
        <p className="text-sm">{r.venue.legalName}{r.venue.taxNumber ? ` · Tax no. ${r.venue.taxNumber}` : ""}</p>
        <p className="text-sm">{[r.venue.branch, r.venue.address, r.venue.phone].filter(Boolean).join(" · ")}</p>
      </header>
      <p className="mb-4 text-sm">Receipt <b>{r.bill.number}</b> · {new Date(r.bill.closedAt ?? r.bill.openedAt).toLocaleString()}{r.bill.table ? ` · Table ${r.bill.table}` : ""}{r.bill.customer ? ` · ${r.bill.customer}` : ""}</p>
      <table className="w-full text-sm">
        <thead><tr className="border-b border-black/30 text-left"><th className="py-1">Item</th><th className="py-1 text-right">Qty</th><th className="py-1 text-right">Price</th><th className="py-1 text-right">Total</th></tr></thead>
        <tbody>
          {r.items.map((i, n) => (
            <tr key={n} className="border-b border-black/10"><td className="py-1">{i.name}</td><td className="py-1 text-right">{i.quantity}</td><td className="py-1 text-right">{i.unitPrice}</td><td className="py-1 text-right">{i.total}</td></tr>
          ))}
        </tbody>
      </table>
      {r.play.length > 0 && <p className="mt-3 text-xs">Play: {r.play.map((p) => `${p.station ?? "station"} ${p.minutes} min`).join(", ")}</p>}
      <dl className="ml-auto mt-4 grid w-64 grid-cols-2 gap-1 text-sm">
        <dt>Subtotal</dt><dd className="text-right">{money(r.totals.subtotal)}</dd>
        {Number(r.totals.discount) > 0 && <><dt>Discount</dt><dd className="text-right">−{money(r.totals.discount)}</dd></>}
        <dt>Tax</dt><dd className="text-right">{money(r.totals.tax)}</dd>
        <dt className="font-bold">Total</dt><dd className="text-right font-bold">{money(r.totals.total)}</dd>
        {r.payments.flatMap((p, n) => [<dt key={`m${n}`}>{p.method.toLowerCase()}{p.refunded ? " (refunded)" : ""}</dt>, <dd key={`a${n}`} className="text-right">{money(p.amount)}</dd>])}
        {Number(r.totals.due) > 0 && <><dt className="font-bold">Due</dt><dd className="text-right font-bold">{money(r.totals.due)}</dd></>}
      </dl>
      <p className="mt-10 text-center text-xs">Thank you for playing at {r.venue.name}.</p>
      <button onClick={() => window.print()} className="mt-6 rounded bg-black px-4 py-2 text-sm text-white print:hidden">Print</button>
    </main>
  );
}

export default function ReceiptPage() {
  return (
    <Suspense>
      <ReceiptView />
    </Suspense>
  );
}
