import { useSyncExternalStore } from "react";
import { AR } from "./i18n-ar";

/**
 * English / Arabic for the whole app. Strings are written in English at the
 * call site — t("Book a station") — and looked up in the Arabic table; a
 * missing entry falls back to English. {name}-style placeholders are filled
 * from `vars`. The choice is kept on the account (and in this browser before
 * signing in).
 */
export type Lang = "en" | "ar";
const KEY = "arena.customer.lang";

const read = (): Lang => {
  try {
    return localStorage.getItem(KEY) === "ar" ? "ar" : "en";
  } catch {
    return "en";
  }
};

let lang: Lang = read();
const listeners = new Set<() => void>();
const apply = () => {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
};
apply();

export function setLang(l: Lang) {
  if (l === lang) return;
  lang = l;
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* private mode: this tab only */
  }
  apply();
  listeners.forEach((f) => f());
}

export const getLang = () => lang;
export const dir = () => (lang === "ar" ? "rtl" : "ltr");
/** For toLocaleString: Arabic dates in Arabic, otherwise the phone's own format. */
export const locale = () => (lang === "ar" ? "ar-AE" : undefined);

export function useLang() {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => lang,
  );
}

export function t(en: string, vars?: Record<string, string | number>): string {
  const s = (lang === "ar" && AR[en]) || en;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}
