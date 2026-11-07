import { Analytics } from "@vercel/analytics/next";
import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";
import { Providers } from "./components/providers";
import { SiteShell } from "./components/site-shell";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SOLSocial",
  description:
    "Host events and build communities. Ticketing happens on-chain and guests who show up split a share of the entry-fee pool.",
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const rpc = process.env.SOLANA_RPC_URL ?? "";
  const localRpc = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\]):8899\/?$/.test(
    rpc
  );
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} antialiased`}
      >
        <Providers defaultCluster={localRpc ? "localnet" : "devnet"}>
          <SiteShell>{children}</SiteShell>
        </Providers>
        <Analytics />
      </body>
    </html>
  );
}
