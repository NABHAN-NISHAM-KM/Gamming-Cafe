import { createTransport, type Transporter } from "nodemailer";

export interface MailConfig {
  SMTP_HOST?: string;
  SMTP_PORT?: number;
  SMTP_SECURE?: string;
  SMTP_USER?: string;
  SMTP_PASSWORD?: string;
  MAIL_FROM?: string;
}

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export type MailResult = { ok: true } | { ok: false; error: string };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
/** Plain text in a simple, safe HTML frame: every mail is readable without images or styles. */
export const htmlOf = (text: string) => `<div style="font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#111;max-width:520px">${esc(text).replace(/\n/g, "<br>")}</div>`;

/**
 * Sends mail through the SMTP server saved in Settings. It reads the config
 * object on every send, so a change in the console applies without a restart.
 * Nothing here throws: a mail that can't be sent is reported to the caller,
 * who decides whether that matters (a reset code does; a lead notice doesn't).
 */
export class MailService {
  private cached?: { key: string; t: Transporter };

  constructor(private readonly cfg: MailConfig) {}

  get configured() {
    return !!this.cfg.SMTP_HOST && !!this.cfg.MAIL_FROM;
  }

  private transporter() {
    const c = this.cfg;
    const key = JSON.stringify([c.SMTP_HOST, c.SMTP_PORT, c.SMTP_SECURE, c.SMTP_USER, c.SMTP_PASSWORD]);
    if (this.cached?.key !== key) {
      this.cached = {
        key,
        t: createTransport({
          host: c.SMTP_HOST, port: c.SMTP_PORT ?? 587, secure: c.SMTP_SECURE === "on",
          auth: c.SMTP_USER ? { user: c.SMTP_USER, pass: c.SMTP_PASSWORD ?? "" } : undefined,
          connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 15000,
        }),
      };
    }
    return this.cached.t;
  }

  async send(m: Mail): Promise<MailResult> {
    if (!this.configured) return { ok: false, error: "Mail isn't set up yet (Settings → Mail)." };
    try {
      await this.transporter().sendMail({ from: this.cfg.MAIL_FROM, to: m.to, subject: m.subject.replace(/[\r\n]+/g, " ").slice(0, 200), text: m.text, html: m.html ?? htmlOf(m.text) });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : "The mail server refused the message." };
    }
  }

  /** Connects and signs in without sending anything: the quickest way to find a wrong password. */
  async verify(): Promise<MailResult> {
    if (!this.cfg.SMTP_HOST) return { ok: false, error: "No mail server is set." };
    try {
      await this.transporter().verify();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : "Couldn't connect." };
    }
  }
}
