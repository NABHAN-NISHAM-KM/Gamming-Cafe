"use client";

import { useEffect, useState } from "react";
import { Clock3, Languages, LogIn, LogOut, Users } from "lucide-react";
import { api, ApiError } from "@/lib/client/api";
import { useAction, useApi } from "@/lib/client/hooks";
import { useBranch } from "@/lib/client/branch";
import { setLang, useLang, useT } from "@/lib/client/i18n";
import { Button, ErrorNote, Field, Input, Modal, Select, toast } from "@/components/ui";

interface Clock {
  open: { id: string; branch: { id: string; name: string; code: string }; clockInAt: string; hours: number } | null;
}

/** Header controls for whoever is at the counter: clock in/out, hand over by PIN, language. */
export function StaffBar() {
  const t = useT();
  const lang = useLang();
  const { branchId } = useBranch();
  const clock = useApi<Clock>("/clock");
  const [switching, setSwitching] = useState(false);

  const toggle = useAction(async () => {
    if (clock.data?.open) {
      const r = await api<{ worked: number }>("/clock-out", { method: "POST" });
      toast(`${t("clock.done")} ${t("clock.worked")}: ${r.worked} h`);
    } else {
      if (!branchId) return;
      await api(`/branches/${branchId}/clock-in`, { method: "POST" });
      toast(t("clock.inDone"));
    }
    await clock.reload();
  });

  useEffect(() => {
    if (toggle.error) toast(toggle.error, "warn");
  }, [toggle.error]);

  const open = clock.data?.open;
  return (
    <>
      {clock.data && (
        <Button
          size="sm"
          variant={open ? "ghost" : "primary"}
          pending={toggle.pending}
          onClick={() => void toggle.run()}
          title={open ? `${t("clock.since")} ${new Date(open.clockInAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · ${open.branch.code}` : undefined}
        >
          {open ? <LogOut className="size-3.5" /> : <LogIn className="size-3.5" />}
          <span className="hidden sm:inline">{open ? t("clock.out") : t("clock.in")}</span>
          {open && <span className="hidden items-center gap-1 text-[11px] text-ink-3 md:flex"><Clock3 className="size-3" />{new Date(open.clockInAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
        </Button>
      )}
      <Button size="sm" variant="ghost" onClick={() => setSwitching(true)} title={t("switch.title")}>
        <Users className="size-3.5" /> <span className="hidden lg:inline">{t("switch.title")}</span>
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setLang(lang === "ar" ? "en" : "ar")} aria-label={t("lang")} title={t("lang")}>
        <Languages className="size-3.5" /> <span className="hidden md:inline">{t("lang")}</span>
      </Button>
      <SwitchStaff open={switching} onClose={() => setSwitching(false)} />
    </>
  );
}

function SwitchStaff({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const staff = useApi<Array<{ id: string; displayName: string }>>(open ? "/auth/pin-staff" : null);
  const [who, setWho] = useState("");
  const [pin, setPin] = useState("");
  const go = useAction(async () => {
    const res = await fetch("/api/session/pin-switch", { method: "POST", headers: { "content-type": "application/json", "x-arena-csrf": "1" }, body: JSON.stringify({ employeeId: who, pin }) });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setPin("");
      if (body?.error === "full_sign_in_required") throw new Error(t("switch.mfa"));
      if (body?.error === "invalid_credentials") throw new Error(t("switch.bad"));
      throw new ApiError(res.status, body);
    }
    // A different person now: reload everything (menus, permissions, branch).
    window.location.assign("/");
  });
  const list = staff.data ?? [];
  return (
    <Modal open={open} onClose={onClose} title={t("switch.title")}>
      {staff.data && list.length === 0 ? (
        <p className="text-sm text-ink-2">{t("switch.none")}</p>
      ) : (
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void go.run();
          }}
        >
          <Field label={t("switch.who")}>
            <Select value={who} onChange={(e) => setWho(e.target.value)} required autoFocus>
              <option value="" disabled>—</option>
              {list.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}
            </Select>
          </Field>
          <Field label={t("switch.pin")}>
            <Input type="password" inputMode="numeric" autoComplete="off" pattern="\d{4,8}" maxLength={8} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} required />
          </Field>
          <ErrorNote>{go.error}</ErrorNote>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" pending={go.pending} disabled={!who || pin.length < 4}>{t("switch.go")}</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
