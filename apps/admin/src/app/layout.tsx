import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ReasonProvider } from "@/components/reason";
import "./globals.css";

export const metadata: Metadata = {
  title: "ArenaOS Admin",
  description: "Operations console for gaming venues",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ReasonProvider>{children}</ReasonProvider>
      </body>
    </html>
  );
}
