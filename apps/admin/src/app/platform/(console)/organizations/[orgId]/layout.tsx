import type { ReactNode } from "react";
import { demoParams, demoOrgIds } from "@/lib/server/demo-params";

// Static demo build: which ids to pre-render (see lib/server/demo-params.ts).
export const generateStaticParams = () => demoParams("orgId", demoOrgIds);

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
