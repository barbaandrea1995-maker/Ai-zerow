import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI-ZEROW COMMAND · Control Center",
  description: "Operational command center for jobs, assets, teams and governed AI workflows.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="it">
      <body className="antialiased">{children}</body>
    </html>
  );
}
