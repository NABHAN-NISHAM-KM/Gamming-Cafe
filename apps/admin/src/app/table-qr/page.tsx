"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import QRCode from "qrcode";
import { api } from "@/lib/client/api";

/** One printable card per table: scan it to see the menu and order to that table's bill in the customer app. */
function TableQr() {
  const branchId = useSearchParams().get("branch");
  const [data, setData] = useState<{ branch: string; tables: Array<{ id: string; name: string; url: string; qr?: string }> } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!branchId) return;
    api<{ branch: string; tables: Array<{ id: string; name: string; url: string }> }>(`/branches/${branchId}/table-qr`)
      .then(async (d) => setData({ ...d, tables: await Promise.all(d.tables.map(async (t) => ({ ...t, qr: await QRCode.toDataURL(t.url, { margin: 1, width: 260 }) }))) }))
      .catch((e: Error) => setErr(e.message));
  }, [branchId]);
  if (err) return <p className="p-8 text-danger">{err}</p>;
  if (!data) return <p className="p-8">Loading…</p>;
  return (
    <main className="bg-white p-8 text-black">
      <div className="mb-6 flex items-center justify-between print:hidden">
        <h1 className="text-xl font-bold">Table QR codes · {data.branch}</h1>
        <button onClick={() => window.print()} className="rounded bg-black px-4 py-2 text-sm text-white">Print</button>
      </div>
      {data.tables.length === 0 ? <p>No tables yet — add them in Restaurant → Tables.</p> : (
        <div className="grid grid-cols-3 gap-6">
          {data.tables.map((t) => (
            <figure key={t.id} className="break-inside-avoid rounded-xl border-2 border-black p-4 text-center">
              {t.qr && <img src={t.qr} alt={`QR code for table ${t.name}`} className="mx-auto w-48" />}
              <figcaption className="mt-2">
                <p className="text-2xl font-bold">Table {t.name}</p>
                <p className="text-sm">Scan to see the menu and order — it goes on this table's bill.</p>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </main>
  );
}

export default function TableQrPage() {
  return (
    <Suspense>
      <TableQr />
    </Suspense>
  );
}
