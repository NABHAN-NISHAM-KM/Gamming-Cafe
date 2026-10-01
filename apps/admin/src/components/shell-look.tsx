"use client";

import { useRef, useState } from "react";
import { ImageUp, Monitor, X } from "lucide-react";
import { api } from "@/lib/client/api";
import { useAction, useApi } from "@/lib/client/hooks";
import { Button, Card, ErrorNote, Field, Input } from "@/components/ui";

type Brand = { id: string; name: string; logoUrl: string | null; shellTheme: Record<string, unknown> | null };

const httpsOk = (v: string) => v === "" || /^https:\/\/[^\s"'()<>]+$/.test(v) || v.startsWith("data:image/");

// Must match the API's WALLPAPER_DATA_MAX / LOGO_DATA_MAX (apps/api/src/devices/device-gateway.ts).
const WALLPAPER_MAX = 360_000;
const LOGO_MAX = 80_000;

/** Shrinks a picked picture in the browser to fit the box and a size budget, as a data: URL. */
async function shrink(file: File, maxW: number, maxH: number, maxLen: number, keepAlpha: boolean): Promise<string> {
  const img = await createImageBitmap(file).catch(() => {
    throw new Error("That file isn't a picture we can read. Use a JPG, PNG or WebP.");
  });
  const scale = Math.min(1, maxW / img.width, maxH / img.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  if (keepAlpha) {
    const png = canvas.toDataURL("image/png");
    if (png.length <= maxLen) return png;
  }
  for (const q of [0.85, 0.75, 0.65, 0.55, 0.45, 0.35]) {
    const out = canvas.toDataURL(keepAlpha ? "image/webp" : "image/jpeg", q);
    if (out.length <= maxLen) return out;
  }
  throw new Error("That picture is too detailed to fit. Try a simpler or smaller one.");
}

/** Settings → Gaming Shell look: each brand's desktop wallpaper and logo on the gaming PCs. */
export function ShellLook() {
  const brands = useApi<Brand[]>("/brands");
  if (!brands.data?.length) return null;
  return (
    <Card className="mb-4 max-w-2xl p-6">
      <div className="flex items-start gap-3">
        <Monitor className="mt-0.5 size-5 text-accent" />
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Gaming Shell look</h2>
          <p className="mt-1 text-sm text-ink-2">
            The picture behind the desktop and sign-in screen on your gaming PCs, and your logo. Upload a picture or paste a link (https://…); wallpapers look best at 1920×1080.
            PCs pick it up the next time they connect.
          </p>
          {brands.data.map((b) => (
            <BrandLook key={b.id} brand={b} showName={brands.data!.length > 1} onSaved={() => void brands.reload()} />
          ))}
        </div>
      </div>
    </Card>
  );
}

function BrandLook({ brand, showName, onSaved }: { brand: Brand; showName: boolean; onSaved: () => void }) {
  const [wallpaper, setWallpaper] = useState(String(brand.shellTheme?.["wallpaperUrl"] ?? ""));
  const [logo, setLogo] = useState(brand.logoUrl ?? "");
  const valid = httpsOk(wallpaper.trim()) && httpsOk(logo.trim());
  const save = useAction(async () => {
    await api(`/brands/${brand.id}`, {
      method: "PATCH",
      action: "Save Gaming Shell look",
      body: { logoUrl: logo.trim() || null, shellTheme: { ...(brand.shellTheme ?? {}), wallpaperUrl: wallpaper.trim() || null } },
    });
    onSaved();
  });
  return (
    <form
      className="mt-5 grid gap-4 border-t border-line pt-5 first:border-t-0"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) void save.run();
      }}
    >
      {showName && <p className="text-sm font-medium">{brand.name}</p>}
      <div className="relative aspect-video overflow-hidden rounded-xl border border-line bg-[#07060d]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {wallpaper.trim() && httpsOk(wallpaper.trim()) && <img src={wallpaper.trim()} alt="" className="absolute inset-0 size-full object-cover" />}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/55" />
        <div className="absolute left-4 top-4 flex items-center gap-2 text-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {logo.trim() && httpsOk(logo.trim()) ? <img src={logo.trim()} alt="" className="h-8" /> : <span className="grid size-8 place-items-center rounded-lg bg-white/20 font-bold">{brand.name.slice(0, 1)}</span>}
          <span className="text-sm font-semibold">{brand.name}</span>
        </div>
        <p className="absolute bottom-3 left-4 text-xs text-white/70">Preview</p>
      </div>
      <Field label="Wallpaper" hint="Leave empty for the standard ArenaOS background.">
        <ImagePicker value={wallpaper} onChange={setWallpaper} placeholder="https://yourvenue.com/wallpaper.jpg" pick={(f) => shrink(f, 1920, 1080, WALLPAPER_MAX, false)} />
      </Field>
      <Field label="Logo">
        <ImagePicker value={logo} onChange={setLogo} placeholder="https://yourvenue.com/logo.png" pick={(f) => shrink(f, 512, 256, LOGO_MAX, true)} />
      </Field>
      {!valid && <p className="text-sm text-reserved">Links must start with https://</p>}
      <ErrorNote>{save.error}</ErrorNote>
      <div>
        <Button type="submit" variant="primary" pending={save.pending} disabled={!valid}>Save</Button>
      </div>
    </form>
  );
}

/** A link box with an Upload button; an uploaded picture shows as a chip instead of its (huge) data: URL. */
function ImagePicker({ value, onChange, placeholder, pick }: { value: string; onChange: (v: string) => void; placeholder: string; pick: (f: File) => Promise<string> }) {
  const file = useRef<HTMLInputElement>(null);
  const load = useAction(async (f: File) => onChange(await pick(f)));
  const uploaded = value.startsWith("data:");
  return (
    <div className="grid gap-1.5">
      <div className="flex gap-2">
        {uploaded ? (
          <span className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-line-strong bg-bg/70 px-3 text-sm text-ink-2">
            <ImageUp className="size-4 shrink-0 text-accent" />Uploaded picture
            <button type="button" onClick={() => onChange("")} className="ml-auto rounded p-1 text-ink-3 hover:bg-panel-2 hover:text-ink" aria-label="Remove picture"><X className="size-4" /></button>
          </span>
        ) : (
          <Input type="url" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="flex-1" />
        )}
        <Button type="button" pending={load.pending} onClick={() => file.current?.click()}><ImageUp className="size-4" />Upload</Button>
        <input
          ref={file}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void load.run(f);
          }}
        />
      </div>
      <ErrorNote>{load.error}</ErrorNote>
    </div>
  );
}
