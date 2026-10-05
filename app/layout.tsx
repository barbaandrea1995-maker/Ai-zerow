import type { Metadata, Viewport } from "next";
import { GlobalModuleControls, type GlobalAuthority } from "@/components/global-module-controls";
import { PwaRegister } from "@/components/pwa-register";
import { getAuthorityContext } from "@/lib/authority-context";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI-ZEROW COMMAND · Control Center",
  description: "Operational command center for jobs, assets, teams and governed AI workflows.",
  other: {
    "codex-preview": "development",
  },
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
  let authority: GlobalAuthority | null = null;
  try {
    const context = await getAuthorityContext();
    if (context) authority = { role: context.role, capabilities: context.capabilities };
  } catch {
    authority = null;
  }

  return (
    <html lang="it">
      <body className="antialiased"><PwaRegister />{children}<GlobalModuleControls initialAuthority={authority} /></body>
    </html>
  );
}
