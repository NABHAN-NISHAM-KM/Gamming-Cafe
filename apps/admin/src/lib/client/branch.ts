"use client";

import { useEffect, useState } from "react";
import { useApi } from "./hooks";
import { useMe } from "./me";
import type { Branch } from "./types";

const KEY = "arena.branch";

/**
 * The branch a page works on: the last one picked (remembered in this browser),
 * else the user's own branch, else the first. Shared by Live Floor, Computers,
 * Sessions… so switching once sticks everywhere.
 */
export function useBranch() {
  const me = useMe();
  const branches = useApi<Branch[]>("/branches");
  const [branchId, setId] = useState<string | null>(null);

  useEffect(() => {
    if (branchId || !branches.data?.length) return;
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(KEY);
    } catch {
      /* storage unavailable (private mode) — fall through */
    }
    const own = me.grants.find((g) => g.branchId)?.branchId ?? null;
    const pick = [saved, own].find((id) => id && branches.data!.some((b) => b.id === id)) ?? branches.data[0]!.id;
    setId(pick);
  }, [branches.data, branchId, me.grants]);

  const setBranchId = (id: string) => {
    setId(id);
    try {
      localStorage.setItem(KEY, id);
    } catch {
      /* ignore */
    }
  };

  return { branches, branchId, setBranchId, branch: branches.data?.find((b) => b.id === branchId) };
}
