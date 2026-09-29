import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { ReasonProvider } from "@/components/reason";
import { DemoBoot } from "@/components/demo";
import "@arena/theme/fonts";
import "./globals.css";

export const viewport: Viewport = { themeColor: "#07070c", colorScheme: "dark" };

export const metadata: Metadata = {
  title: "ArenaOS Admin",
  description: "Operations console for gaming venues",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <DemoBoot>
          <ReasonProvider>{children}</ReasonProvider>
        </DemoBoot>
      </body>
    </html>
  );
}
