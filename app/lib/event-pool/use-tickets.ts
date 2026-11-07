"use client";

import useSWR from "swr";
import type { Address } from "@solana/kit";
import { useCluster } from "../../components/cluster-context";
import { useSolanaClient } from "../solana-client-context";
import {
  fetchEventTickets,
  fetchMemberTickets,
  type TicketRecord,
} from "./tickets-chain";

/** Every Ticket of an event (memcmp on the event field). `undefined` while loading. */
export function useEventTickets(pda: string | undefined, refreshMs = 10_000) {
  const { cluster } = useCluster();
  const client = useSolanaClient();
  const { data, error, isLoading, mutate } = useSWR(
    pda ? (["event-tickets", cluster, pda] as const) : null,
    ([, , p]) => fetchEventTickets(client.rpc, p as Address),
    { refreshInterval: refreshMs, revalidateOnFocus: true }
  );
  return {
    tickets: data as TicketRecord[] | undefined,
    isLoading,
    error: error as Error | undefined,
    mutate,
  };
}

/** Every Ticket held by a wallet (memcmp on the member field). */
export function useMemberTickets(
  member: string | undefined,
  refreshMs = 15_000
) {
  const { cluster } = useCluster();
  const client = useSolanaClient();
  const { data, error, isLoading, mutate } = useSWR(
    member ? (["member-tickets", cluster, member] as const) : null,
    ([, , m]) => fetchMemberTickets(client.rpc, m as Address),
    { refreshInterval: refreshMs, revalidateOnFocus: true }
  );
  return {
    tickets: data as TicketRecord[] | undefined,
    isLoading,
    error: error as Error | undefined,
    mutate,
  };
}
