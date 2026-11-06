import { apiFetch, apiJson } from "../api-client";
import type { EventMetadata } from "../metadata";

/** Mirrors the server's `OnChainSummary` (decimal-string lamports). */
export type ApiOnChain = {
  host: string;
  entryFee: string;
  capacity: number;
  ticketsSold: number;
  checkedIn: number;
  startTs: number;
  endTs: number;
  status: "open" | "ended" | "cancelled";
};

export type ApiEventSummary = {
  eventPda: string;
  hostWallet: string;
  title: string;
  summary: string;
  coverUrl: string | null;
  visibility: "public" | "network";
  metadataHash: string;
  createdAt: string;
  onchain: ApiOnChain | null;
};

export type ApiEventDetails = {
  eventPda: string;
  title: string;
  summary: string;
  coverUrl: string | null;
  details: unknown;
};

export type PostEventBody = EventMetadata & {
  eventPda: string;
  visibility?: "public" | "network";
};

/** POST /api/events (needs a signed-in session). A 409 means it is already registered. */
export async function postEvent(body: PostEventBody): Promise<ApiEventSummary> {
  return apiJson<ApiEventSummary>("/api/events", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** GET /api/events/[pda]; returns null when the API has no record (404). */
export async function fetchEventSummary(
  pda: string
): Promise<ApiEventSummary | null> {
  const res = await apiFetch(`/api/events/${pda}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Event request failed (${res.status})`);
  return (await res.json()) as ApiEventSummary;
}

/** GET /api/events/[pda]/details (JWT; host or ticket holder). */
export async function fetchEventDetails(pda: string): Promise<ApiEventDetails> {
  return apiJson<ApiEventDetails>(`/api/events/${pda}/details`);
}
