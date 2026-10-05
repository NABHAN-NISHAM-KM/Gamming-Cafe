"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";

/**
 * Minimal data hook: loads on mount / path change, exposes reload().
 * `refreshMs` keeps a live screen current: refetches quietly (no spinner) on that interval
 * while the tab is visible, and straight away when the tab comes back into view.
 */
export function useApi<T>(path: string | null, refreshMs?: number) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!!path);
  const seq = useRef(0);

  const reload = useCallback(async (quiet = false) => {
    if (!path) return;
    const mine = ++seq.current;
    if (!quiet) setLoading(true);
    try {
      const d = await api<T>(path);
      if (mine === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (mine === seq.current) setError(e instanceof ApiError ? e : new ApiError(0, null));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!refreshMs || !path) return;
    const tick = () => { if (document.visibilityState === "visible") void reload(true); };
    const t = setInterval(tick, refreshMs);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", tick); };
  }, [reload, refreshMs, path]);

  return { data, error, loading, reload, setData };
}

/** Wraps an async action with pending + error state for buttons and forms. */
export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async (...args: A): Promise<R | undefined> => {
      setPending(true);
      setError(null);
      try {
        return await fn(...args);
      } catch (e) {
        if (e instanceof ApiError && e.status === 499) return undefined; // user cancelled reason prompt
        setError(e instanceof Error ? e.message : "Something went wrong.");
        return undefined;
      } finally {
        setPending(false);
      }
    },
    [fn],
  );
  return { run, pending, error, setError };
}
