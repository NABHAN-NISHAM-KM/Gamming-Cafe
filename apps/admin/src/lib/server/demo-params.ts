import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Static demo build (ARENA_DEMO=1, output: export): pre-render the dynamic
 * pages for the demo's records plus a "_" placeholder that the demo host
 * serves for ids created later. Normal builds pre-render nothing here.
 */
export const IS_DEMO_EXPORT = process.env["NEXT_PUBLIC_ARENA_DEMO"] === "1";

function fixture(name: string): Record<string, any> {
  return JSON.parse(readFileSync(resolve(process.cwd(), "../../packages/demo/src/fixtures", `${name}.json`), "utf8"));
}

export function demoParams<K extends string>(key: K, ids: () => string[]): Array<Record<K, string>> {
  if (!IS_DEMO_EXPORT) return [];
  return ["_", ...ids()].map((id) => ({ [key]: id }) as Record<K, string>);
}

export const demoBranchIds = () => (fixture("staff")["/branches"] as Array<{ id: string }>).map((b) => b.id);
export const demoEmployeeIds = () => (fixture("staff")["/employees"] as Array<{ id: string }>).map((e) => e.id);
export const demoOrgIds = () => (fixture("platform")["/organizations"] as Array<{ id: string }>).map((o) => o.id);
