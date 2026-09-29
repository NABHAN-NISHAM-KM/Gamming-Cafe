"use client";

import { usePathname } from "next/navigation";

/**
 * The id at the end of the current URL (/branches/<id>, /employees/<id>…).
 * Read from the path rather than route params so the static demo build can
 * serve one pre-rendered page for any id, including records created in the demo.
 */
export function useRouteId(fallback: string): string {
  const path = usePathname() ?? "";
  const last = path.split("/").filter(Boolean).at(-1);
  return last && last !== "_" ? decodeURIComponent(last) : fallback;
}
