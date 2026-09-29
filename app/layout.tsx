import type { Metadata } from "next";
import { PwaRegister } from "@/components/pwa-register";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI-ZEROW COMMAND · Control Center",
  description: "Operational command center for jobs, assets, teams and governed AI workflows.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/ai-zerow-icon.jpeg",
    shortcut: "/ai-zerow-icon.jpeg",
  },
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="it">
      <body className="antialiased"><PwaRegister />{children}</body>
    </html>
  );
}
