import type { ReactNode } from "react";
import { demoParams, demoBranchIds } from "@/lib/server/demo-params";

// Static demo build: which ids to pre-render (see lib/server/demo-params.ts).
export const generateStaticParams = () => demoParams("branchId", demoBranchIds);

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
