import type { Metadata, Viewport } from "next";
import { GlobalModuleControls, type GlobalAuthority } from "@/components/global-module-controls";
import { PwaRegister } from "@/components/pwa-register";
import { getAuthorityContext } from "@/lib/authority-context";
import { warmJobStockSchema } from "@/lib/job-stock-schema.server";
import {
  mobileNavigationForAuthority,
  type MobileNavigationContract,
} from "@/lib/mobile-navigation";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI-ZEROW COMMAND · Control Center",
  description: "Operational command center for jobs, assets, teams and governed AI workflows.",
  icons: {
    icon: [
      { url: "/icons/ai-zerow-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icons/ai-zerow-512.png", type: "image/png", sizes: "512x512" },
    ],
    shortcut: "/icons/ai-zerow-192.png",
    apple: [{ url: "/icons/ai-zerow-180.png", type: "image/png", sizes: "180x180" }],
  },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "dark",
  themeColor: "#030504",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await warmJobStockSchema();

  let authority: GlobalAuthority | null = null;
  let mobileNavigation: MobileNavigationContract | null = null;
  try {
    const context = await getAuthorityContext();
    if (context) {
      authority = {
        role: context.role,
        roles: context.roles,
        capabilities: context.capabilities,
        actorName: context.actorName,
        actorEmail: context.actorEmail,
      };
      mobileNavigation = mobileNavigationForAuthority(context);
    }
  } catch {
    authority = null;
    mobileNavigation = null;
  }

  return (
    <html lang="it">
      <body className={authority ? "antialiased zw-commercial-shell" : "antialiased"}><PwaRegister />{children}<GlobalModuleControls initialAuthority={authority} mobileNavigation={mobileNavigation} /></body>
    </html>
  );
}
