"use client";

import useSWR from "swr";
import type { Address } from "@solana/kit";
import {
  fetchAllMaybeVendorProfile,
  fetchMaybeVendorProfile,
  findSponsorshipPda,
  findVendorProfilePda,
  fetchMaybeSponsorship,
  type Sponsorship,
  type VendorProfile,
} from "../../generated/event_pool";
import { useCluster } from "../../components/cluster-context";
import { useSolanaClient } from "../solana-client-context";
import { useAuth } from "../hooks/use-auth";
import {
  fetchOffers,
  fetchVendor,
  type ApiOffer,
  type ApiVendor,
} from "./vendor-api";
import {
  fetchEventSponsorships,
  fetchVendorSponsorships,
  type SponsorshipRecord,
} from "./vendor";

/** On-chain VendorProfile for a wallet. `null` when not registered, `undefined` while loading. */
export function useVendorProfile(
  wallet: string | undefined,
  refreshMs = 10_000
) {
  const { cluster } = useCluster();
  const client = useSolanaClient();
  const { data, error, isLoading, mutate } = useSWR(
    wallet ? (["vendor-profile", cluster, wallet] as const) : null,
    async ([, , w]) => {
      const [pda] = await findVendorProfilePda({ vendor: w as Address });
      const acc = await fetchMaybeVendorProfile(client.rpc, pda);
      return acc.exists ? acc.data : null;
    },
    { refreshInterval: refreshMs, revalidateOnFocus: true }
  );
  return {
    profile: data as VendorProfile | null | undefined,
    isLoading,
    error: error as Error | undefined,
    mutate,
  };
}

/** Off-chain vendor profile (name, logo, description) from the API. */
export function useVendorApiProfile(wallet: string | undefined) {
  const { data, error, isLoading, mutate } = useSWR(
    wallet ? (["vendor-api", wallet] as const) : null,
    ([, w]) => fetchVendor(w),
    { revalidateOnFocus: false }
  );
  return {
    vendor: data as ApiVendor | null | undefined,
    isLoading,
    error: error as Error | undefined,
    mutate,
  };
}

/** The (event, vendor) Sponsorship, or `null` if none was proposed. */
export function useSponsorship(
  event: string | undefined,
  vendor: string | undefined,
  refreshMs = 8_000
) {
  const { cluster } = useCluster();
  const client = useSolanaClient();
  const { data, error, isLoading, mutate } = useSWR(
    event && vendor ? (["sponsorship", cluster, event, vendor] as const) : null,
    async ([, , e, v]) => {
      const [address] = await findSponsorshipPda({
        event: e as Address,
        vendor: v as Address,
      });
      const acc = await fetchMaybeSponsorship(client.rpc, address);
      return { address, sponsorship: acc.exists ? acc.data : null };
    },
    { refreshInterval: refreshMs, revalidateOnFocus: true }
  );
  return {
    sponsorship: data?.sponsorship as Sponsorship | null | undefined,
    sponsorshipAddress: data?.address,
    isLoading,
    error: error as Error | undefined,
    mutate,
  };
}

/** Every Sponsorship of an event (memcmp on the event field). */
export function useEventSponsorships(
  event: string | undefined,
  refreshMs = 8_000
) {
  const { cluster } = useCluster();
  const client = useSolanaClient();
  const { data, error, isLoading, mutate } = useSWR(
    event ? (["event-sponsorships", cluster, event] as const) : null,
    ([, , e]) => fetchEventSponsorships(client.rpc, e as Address),
    { refreshInterval: refreshMs, revalidateOnFocus: true }
  );
  return {
    sponsorships: data as SponsorshipRecord[] | undefined,
    isLoading,
    error: error as Error | undefined,
    mutate,
  };
}

/** Every Sponsorship proposed by a vendor wallet (memcmp on the vendor field). */
export function useVendorSponsorships(
  vendor: string | undefined,
  refreshMs = 15_000
) {
  const { cluster } = useCluster();
  const client = useSolanaClient();
  const { data, error, isLoading, mutate } = useSWR(
    vendor ? (["vendor-sponsorships", cluster, vendor] as const) : null,
    ([, , v]) => fetchVendorSponsorships(client.rpc, v as Address),
    { refreshInterval: refreshMs, revalidateOnFocus: true }
  );
  return {
    sponsorships: data as SponsorshipRecord[] | undefined,
    isLoading,
    error: error as Error | undefined,
    mutate,
  };
}

/** Batch-read VendorProfile accounts; map keyed by vendor wallet -> vendor_key. */
export function useVendorKeys(vendors: readonly string[], refreshMs = 15_000) {
  const { cluster } = useCluster();
  const client = useSolanaClient();
  const key = [...vendors].sort().join(",");
  const { data, mutate } = useSWR(
    key ? (["vendor-keys", cluster, key] as const) : null,
    async ([, , k]) => {
      const wallets = k.split(",");
      const pdas = await Promise.all(
        wallets.map(
          async (w) => (await findVendorProfilePda({ vendor: w as Address }))[0]
        )
      );
      const accounts = await fetchAllMaybeVendorProfile(client.rpc, pdas);
      const map = new Map<string, string>();
      accounts.forEach((a, i) => {
        if (a.exists) map.set(wallets[i], a.data.vendorKey);
      });
      return map;
    },
    { refreshInterval: refreshMs, revalidateOnFocus: true }
  );
  return { vendorKeys: data as Map<string, string> | undefined, mutate };
}

/** Off-chain offers merged with on-chain status (JWT; host or vendor). Fetches once signed in. */
export function useOffers(event: string | undefined) {
  const { isAuthenticated } = useAuth();
  const { data, error, isLoading, mutate } = useSWR(
    event && isAuthenticated ? (["offers", event] as const) : null,
    ([, e]) => fetchOffers(e),
    { revalidateOnFocus: false }
  );
  return {
    offers: data as ApiOffer[] | undefined,
    isLoading,
    error: error as Error | undefined,
    mutate,
  };
}
