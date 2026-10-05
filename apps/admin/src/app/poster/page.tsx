"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import QRCode from "qrcode";
import { api } from "@/lib/client/api";

interface Links { slug: string; name: string; venuePage: string; app: string; referral: string; apk: string }

const KINDS = {
  app: { title: "Get our app", titleAr: "حمّل تطبيقنا", line: "See free PCs, book, top up and order food to your seat.", lineAr: "شاهد الأجهزة المتاحة، احجز، اشحن رصيدك واطلب الطعام إلى مقعدك.", url: (l: Links) => l.apk },
  page: { title: "Book a station", titleAr: "احجز جهازك", line: "Prices, free stations right now and tournaments — book in a minute.", lineAr: "الأسعار والأجهزة المتاحة الآن والبطولات — احجز خلال دقيقة.", url: (l: Links) => l.venuePage },
} as const;

/** A printable A4 poster for the counter, tables or the window: a big QR code to the venue's app or public page, in English and Arabic. */
function Poster() {
  const q = useSearchParams();
  const kind = (q.get("kind") === "page" ? "page" : "app") as keyof typeof KINDS;
  const k = KINDS[kind];
  const [data, setData] = useState<{ links: Links; qr: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api<Links>("/organization/links")
      .then(async (links) => setData({ links, qr: await QRCode.toDataURL(k.url(links), { margin: 1, width: 640 }) }))
      .catch((e: Error) => setErr(e.message));
  }, [k]);
  if (err) return <p className="p-8 text-danger">{err}</p>;
  if (!data) return <p className="p-8">Loading…</p>;
  return (
    <main className="min-h-screen bg-white text-black">
      <div className="flex flex-wrap items-center justify-between gap-3 p-6 print:hidden">
        <div className="flex gap-2 text-sm">
          <a href="?kind=app" className={`rounded px-3 py-1.5 ${kind === "app" ? "bg-black text-white" : "border border-black"}`}>App poster</a>
          <a href="?kind=page" className={`rounded px-3 py-1.5 ${kind === "page" ? "bg-black text-white" : "border border-black"}`}>Venue page poster</a>
        </div>
        <button onClick={() => window.print()} className="rounded bg-black px-4 py-2 text-sm text-white">Print</button>
      </div>
      <section className="mx-auto flex max-w-[190mm] flex-col items-center px-8 pb-10 pt-4 text-center print:pt-10">
        <p className="text-xl font-semibold uppercase tracking-widest">{data.links.name}</p>
        <h1 className="mt-4 text-6xl font-black">{k.title}</h1>
        <p className="mt-2 text-4xl font-bold" dir="rtl" lang="ar">{k.titleAr}</p>
        <img src={data.qr} alt={`QR code to ${k.url(data.links)}`} className="mt-10 w-[110mm]" />
        <p className="mt-8 max-w-xl text-2xl">{k.line}</p>
        <p className="mt-2 max-w-xl text-2xl" dir="rtl" lang="ar">{k.lineAr}</p>
        {kind === "app" && <p className="mt-8 text-2xl">Android app · venue code <b className="font-mono">{data.links.slug}</b> · <span dir="rtl" lang="ar">رمز المكان</span></p>}
        <p className="mt-4 font-mono text-lg">{k.url(data.links).replace(/^https?:\/\//, "")}</p>
      </section>
    </main>
  );
}

export default function PosterPage() {
  return (
    <Suspense>
      <Poster />
    </Suspense>
  );
}
