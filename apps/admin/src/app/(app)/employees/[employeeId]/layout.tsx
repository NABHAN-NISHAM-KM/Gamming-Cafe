import type { ReactNode } from "react";
import { demoParams, demoEmployeeIds } from "@/lib/server/demo-params";

// Static demo build: which ids to pre-render (see lib/server/demo-params.ts).
export const generateStaticParams = () => demoParams("employeeId", demoEmployeeIds);

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
