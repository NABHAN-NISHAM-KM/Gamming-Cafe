"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { PlatformMe } from "./platform";

const Ctx = createContext<PlatformMe | null>(null);

export function PlatformMeProvider({ me, children }: { me: PlatformMe; children: ReactNode }) {
  return <Ctx.Provider value={me}>{children}</Ctx.Provider>;
}

export function usePlatformMe(): PlatformMe {
  const me = useContext(Ctx);
  if (!me) throw new Error("usePlatformMe outside the platform console");
  return me;
}
