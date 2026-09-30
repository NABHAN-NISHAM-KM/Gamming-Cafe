"use client";

import { useState } from "react";
import { Monitor } from "lucide-react";
import { api } from "@/lib/client/api";
import { useAction, useApi } from "@/lib/client/hooks";
import { Button, Card, ErrorNote, Field, Input } from "@/components/ui";

type Brand = { id: string; name: string; logoUrl: string | null; shellTheme: Record<string, unknown> | null };

const httpsOk = (v: string) => v === "" || /^https:\/\/[^\s"'()<>]+$/.test(v);

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
            The picture behind the desktop and sign-in screen on your gaming PCs, and your logo. Use a link to an image (https://…), at least 1920×1080.
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
      <Field label="Wallpaper image link" hint="Leave empty for the standard ArenaOS background.">
        <Input type="url" value={wallpaper} onChange={(e) => setWallpaper(e.target.value)} placeholder="https://yourvenue.com/wallpaper.jpg" />
      </Field>
      <Field label="Logo image link">
        <Input type="url" value={logo} onChange={(e) => setLogo(e.target.value)} placeholder="https://yourvenue.com/logo.png" />
      </Field>
      {!valid && <p className="text-sm text-reserved">Links must start with https://</p>}
      <ErrorNote>{save.error}</ErrorNote>
      <div>
        <Button type="submit" variant="primary" pending={save.pending} disabled={!valid}>Save</Button>
      </div>
    </form>
  );
}
