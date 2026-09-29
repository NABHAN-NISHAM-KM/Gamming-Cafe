"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

/** Everyone signs in at /login; this keeps old links and bookmarks working. */
function Redirect() {
  const router = useRouter();
  const next = useSearchParams().get("next");
  useEffect(() => {
    const target = next && next.startsWith("/platform") && !next.startsWith("//") ? next : "/platform";
    router.replace(`/login?next=${encodeURIComponent(target)}`);
  }, [next, router]);
  return null;
}

export default function PlatformLoginRedirect() {
  return (
    <Suspense>
      <Redirect />
    </Suspense>
  );
}
