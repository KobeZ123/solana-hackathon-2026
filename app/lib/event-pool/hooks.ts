"use client";

import useSWR from "swr";
import type { Address } from "@solana/kit";
import {
  fetchMaybeEvent,
  fetchMaybeTicket,
  findTicketPda,
  type Event,
  type Ticket,
} from "../../generated/event_pool";
import { useCluster } from "../../components/cluster-context";
import { useSolanaClient } from "../solana-client-context";
import { fetchEventSummary, type ApiEventSummary } from "./api";
import { deriveVaultAddress } from "./pda";
import { poolFromVaultBalance } from "./format";

/**
 * Event account straight from the chain (decoded, lamports/timestamps are bigint).
 * `event` is `undefined` while loading and `null` when the account does not exist.
 * Revalidates every `refreshMs` (default 10 s); call `mutate()` after transactions.
 */
export function useEvent(pda: string | undefined, refreshMs = 10_000) {
  const { cluster } = useCluster();
  const client = useSolanaClient();
  const { data, error, isLoading, mutate } = useSWR(
    pda ? (["event", cluster, pda] as const) : null,
    async ([, , address]): Promise<Event | null> => {
      const account = await fetchMaybeEvent(client.rpc, address as Address);
      return account.exists ? account.data : null;
    },
    { refreshInterval: refreshMs, revalidateOnFocus: true }
  );
  return { event: data, isLoading, error: error as Error | undefined, mutate };
}

/** Off-chain summary from `GET /api/events/[pda]` (`null` when the API has no record). */
export function useEventSummary(pda: string | undefined) {
  const { data, error, isLoading, mutate } = useSWR(
    pda ? (["event-summary", pda] as const) : null,
    ([, address]) => fetchEventSummary(address),
    { revalidateOnFocus: false }
  );
  return {
    summary: data as ApiEventSummary | null | undefined,
    isLoading,
    error: error as Error | undefined,
    mutate,
  };
}

/**
 * Live pool for an event: vault lamports and `pool = vault - rent minimum (0 bytes)`.
 * Both are `undefined` until the first read.
 */
export function usePoolBalance(pda: string | undefined, refreshMs = 10_000) {
  const { cluster } = useCluster();
  const client = useSolanaClient();
  const { data, error, isLoading, mutate } = useSWR(
    pda ? (["pool", cluster, pda] as const) : null,
    async ([, , address]) => {
      const vault = await deriveVaultAddress(address as Address);
      const { value } = await client.rpc.getBalance(vault).send();
      return { vault, vaultLamports: value as bigint };
    },
    { refreshInterval: refreshMs, revalidateOnFocus: true }
  );
  return {
    vault: data?.vault,
    vaultLamports: data?.vaultLamports,
    pool: data ? poolFromVaultBalance(data.vaultLamports) : undefined,
    isLoading,
    error: error as Error | undefined,
    mutate,
  };
}

/**
 * Ticket account for (event, member), straight from the chain. `ticket` is `undefined`
 * while loading and `null` when the member holds no ticket. Pass `member` undefined when
 * no wallet is connected. Polls every `refreshMs` (default 5 s); call `mutate()` after txs.
 */
export function useTicket(
  event: string | undefined,
  member: string | undefined,
  refreshMs = 5_000
) {
  const { cluster } = useCluster();
  const client = useSolanaClient();
  const { data, error, isLoading, mutate } = useSWR(
    event && member ? (["ticket", cluster, event, member] as const) : null,
    async ([, , ev, mem]) => {
      const [address] = await findTicketPda({
        event: ev as Address,
        member: mem as Address,
      });
      const account = await fetchMaybeTicket(client.rpc, address);
      return { address, ticket: account.exists ? account.data : null };
    },
    { refreshInterval: refreshMs, revalidateOnFocus: true }
  );
  return {
    ticket: data?.ticket as Ticket | null | undefined,
    ticketAddress: data?.address,
    isLoading,
    error: error as Error | undefined,
    mutate,
  };
}
