"use client";

import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { PropsWithChildren } from "react";
import { ClusterProvider } from "./cluster-context";
import type { ClusterMoniker } from "../lib/solana-client";
import { WalletProvider } from "../lib/wallet/context";
import { SolanaClientProvider } from "../lib/solana-client-context";

export function Providers({
  children,
  defaultCluster,
}: PropsWithChildren<{ defaultCluster: ClusterMoniker }>) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark">
      <ClusterProvider defaultCluster={defaultCluster}>
        <SolanaClientProvider>
          <WalletProvider>{children}</WalletProvider>
        </SolanaClientProvider>
        <Toaster position="bottom-right" richColors />
      </ClusterProvider>
    </ThemeProvider>
  );
}
