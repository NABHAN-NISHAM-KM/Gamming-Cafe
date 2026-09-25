"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ShieldAlert } from "lucide-react";
import { registerReasonPrompt } from "@/lib/client/api";
import { Button, Field, Input, Modal } from "./ui";

/**
 * Sensitive actions (refunds, price changes, role grants…) need a written
 * reason that lands in the audit log. The API says when; this asks the user.
 */
export function ReasonProvider({ children }: { children: ReactNode }) {
  const [ask, setAsk] = useState<{ action: string; resolve: (r: string | null) => void } | null>(null);
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    registerReasonPrompt((action) => new Promise((resolve) => setAsk({ action, resolve })));
  }, []);
  useEffect(() => {
    if (ask) setTimeout(() => input.current?.focus(), 30);
  }, [ask]);

  const finish = (value: string | null) => {
    ask?.resolve(value);
    setAsk(null);
    setText("");
  };

  return (
    <>
      {children}
      <Modal open={!!ask} onClose={() => finish(null)} title="Reason required">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim().length >= 3) finish(text.trim());
          }}
        >
          <p className="flex gap-2 text-sm text-ink-2">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-reserved" />
            <span>
              <strong className="text-ink">{ask?.action}</strong> is a sensitive action. Your reason is saved in the audit log with your name.
            </span>
          </p>
          <Field label="Reason">
            <Input ref={input} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. New hire for evening shift" minLength={3} maxLength={500} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => finish(null)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={text.trim().length < 3}>
              Continue
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
