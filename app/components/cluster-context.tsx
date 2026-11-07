"use client";

import {
  createContext,
  useContext,
  useCallback,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { ClusterMoniker } from "../lib/solana-client";
import { CLUSTERS } from "../lib/solana-client";
import { getExplorerUrl } from "../lib/explorer";

type ClusterContextValue = {
  cluster: ClusterMoniker;
  setCluster: (cluster: ClusterMoniker) => void;
  getExplorerUrl: (path: string) => string;
};

const ClusterContext = createContext<ClusterContextValue | null>(null);

const STORAGE_KEY = "solana-cluster";

const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readCluster(defaultCluster: ClusterMoniker): ClusterMoniker {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && CLUSTERS.includes(stored as ClusterMoniker)) {
      return stored as ClusterMoniker;
    }
  } catch {
    // Storage blocked. Use the configured default.
  }
  return defaultCluster;
}

export { CLUSTERS };

export function ClusterProvider({
  children,
  defaultCluster,
}: {
  children: ReactNode;
  defaultCluster: ClusterMoniker;
}) {
  // The server and the first client render use the configured default. Then the saved choice is applied right
  // after hydration, so a saved non-default cluster no longer causes a hydration mismatch.
  const cluster = useSyncExternalStore<ClusterMoniker>(
    subscribe,
    () => readCluster(defaultCluster),
    () => defaultCluster
  );

  const setCluster = useCallback((c: ClusterMoniker) => {
    try {
      localStorage.setItem(STORAGE_KEY, c);
    } catch {
      // storage blocked: the choice just won't persist
    }
    listeners.forEach((l) => l());
  }, []);

  const explorerUrl = useCallback(
    (path: string) => getExplorerUrl(path, cluster),
    [cluster]
  );

  return (
    <ClusterContext.Provider
      value={{ cluster, setCluster, getExplorerUrl: explorerUrl }}
    >
      {children}
    </ClusterContext.Provider>
  );
}

export function useCluster() {
  const ctx = useContext(ClusterContext);
  if (!ctx) throw new Error("useCluster must be used within ClusterProvider");
  return ctx;
}
