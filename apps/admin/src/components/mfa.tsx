"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Copy, Smartphone } from "lucide-react";
import { Input } from "@/components/ui";

export function CodeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Input
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="\d{6}"
      maxLength={6}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
      className="h-12 text-center font-mono text-xl tracking-[0.5em]"
      autoFocus
      aria-label="6-digit code"
    />
  );
}

/** First-time authenticator setup: QR code plus the key for manual entry. */
export function MfaEnrol({ secret, otpauthUrl, intro }: { secret: string; otpauthUrl: string; intro: string }) {
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    void QRCode.toDataURL(otpauthUrl, { margin: 1, width: 200, color: { dark: "#07070c", light: "#ffffff" } }).then(setQr);
  }, [otpauthUrl]);
  return (
    <div className="grid gap-4">
      <p className="flex gap-2 text-sm text-ink-2">
        <Smartphone className="mt-0.5 size-4 shrink-0 text-accent-2" />
        {intro}
      </p>
      <div className="flex items-center gap-4 rounded-xl border border-line-strong bg-panel-2 p-4">
        <div className="grid size-[120px] shrink-0 place-items-center overflow-hidden rounded-lg bg-white">
          {qr ? <img src={qr} alt="QR code for your authenticator app" className="size-full" /> : <span className="skeleton size-full" />}
        </div>
        <div className="min-w-0 text-xs text-ink-3">
          <p>Can't scan? Enter this key:</p>
          <p className="mt-1 break-all font-mono text-[13px] text-ink">{secret.match(/.{1,4}/g)?.join(" ")}</p>
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(secret).then(() => setCopied(true))}
            className="press mt-2 inline-flex items-center gap-1.5 rounded-md border border-line-strong px-2 py-1 text-ink-2 hover:text-ink"
          >
            <Copy className="size-3" /> {copied ? "Copied" : "Copy key"}
          </button>
        </div>
      </div>
    </div>
  );
}
