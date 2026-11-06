import { isAddress } from "@solana/kit";
import { metadataHashHex } from "../metadata";
import type { AuthContext } from "./auth";
import { getChain, type Chain, type OnChainEvent } from "./chain";
import { ApiError } from "./errors";
import {
  getStore,
  type Store,
  type StoredEvent,
  type Visibility,
} from "./store";

export interface EventDeps {
  store?: Store;
  chain?: Chain;
  now?: () => number; // unix ms
}

/** Chain-derived fields, JSON-safe (lamport amounts are decimal strings). */
export interface OnChainSummary {
  host: string;
  entryFee: string;
  capacity: number;
  ticketsSold: number;
  checkedIn: number;
  startTs: number;
  endTs: number;
  status: OnChainEvent["status"];
}

export interface EventSummary {
  eventPda: string;
  hostWallet: string;
  title: string;
  summary: string;
  coverUrl: string | null;
  visibility: Visibility;
  metadataHash: string;
  createdAt: string;
  /** null when the chain could not be read (RPC error). */
  onchain: OnChainSummary | null;
}

function toOnChain(e: OnChainEvent | null): OnChainSummary | null {
  return e
    ? {
        host: e.host,
        entryFee: e.entryFee.toString(),
        capacity: e.capacity,
        ticketsSold: e.ticketsSold,
        checkedIn: e.checkedIn,
        startTs: e.startTs,
        endTs: e.endTs,
        status: e.status,
      }
    : null;
}

function toSummary(s: StoredEvent, chain: OnChainEvent | null): EventSummary {
  return {
    eventPda: s.eventPda,
    hostWallet: s.hostWallet,
    title: s.title,
    summary: s.summary,
    coverUrl: s.coverUrl,
    visibility: s.visibility,
    metadataHash: s.metadataHash,
    createdAt: s.createdAt,
    onchain: toOnChain(chain),
  };
}

function assertPda(pda: string): void {
  if (!isAddress(pda)) throw new ApiError(400, "Invalid event address");
}

function parseCoverUrl(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || v.length > 2000) {
    throw new ApiError(400, 'Field "coverUrl" must be a string URL');
  }
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    throw new ApiError(400, 'Field "coverUrl" must be a valid URL');
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new ApiError(400, 'Field "coverUrl" must be an http(s) URL');
  }
  return v;
}

/**
 * POST /api/events. The caller must be the on-chain host and the metadata must hash to
 * the Event account's `metadata_hash`.
 */
export async function createEvent(
  auth: AuthContext,
  body: Record<string, unknown>,
  deps: EventDeps = {}
): Promise<EventSummary> {
  const store = deps.store ?? getStore();
  const chain = deps.chain ?? getChain();

  const eventPda = body.eventPda;
  if (typeof eventPda !== "string" || !isAddress(eventPda)) {
    throw new ApiError(400, 'Field "eventPda" must be a valid address');
  }
  const title = body.title;
  if (typeof title !== "string" || title.trim() === "" || title.length > 200) {
    throw new ApiError(
      400,
      'Field "title" must be a non-empty string (max 200)'
    );
  }
  const summary = body.summary ?? "";
  if (typeof summary !== "string" || summary.length > 2000) {
    throw new ApiError(400, 'Field "summary" must be a string (max 2000)');
  }
  const coverUrl = parseCoverUrl(body.coverUrl);
  const details = body.details;
  if (details === undefined || details === null) {
    throw new ApiError(400, 'Field "details" is required');
  }
  if (JSON.stringify(details).length > 50_000) {
    throw new ApiError(400, 'Field "details" is too large');
  }
  const visibility = body.visibility ?? "public";
  if (visibility !== "public" && visibility !== "network") {
    throw new ApiError(400, 'Field "visibility" must be "public" or "network"');
  }

  let onchain: OnChainEvent | null;
  try {
    onchain = await chain.getEvent(eventPda);
  } catch (err) {
    console.error("RPC error reading event", err);
    throw new ApiError(502, "Could not read the Event account from the chain");
  }
  if (!onchain) throw new ApiError(404, "Event account not found on chain");
  if (onchain.host !== auth.wallet) {
    throw new ApiError(403, "Caller is not the host of this event");
  }

  const hash = await metadataHashHex({ title, summary, coverUrl, details });
  if (hash !== onchain.metadataHash) {
    throw new ApiError(
      400,
      "Metadata does not match the on-chain metadata_hash"
    );
  }

  const stored: StoredEvent = {
    eventPda,
    hostWallet: auth.wallet,
    title,
    summary,
    coverUrl,
    details,
    metadataHash: hash,
    visibility,
    createdAt: new Date((deps.now ?? Date.now)()).toISOString(),
  };
  if (!(await store.insertEvent(stored))) {
    throw new ApiError(409, "Event metadata already registered");
  }
  return toSummary(stored, onchain);
}

/** GET /api/events: public events (plus the viewer's own network events), newest first. */
export async function listEvents(
  viewer: AuthContext | null,
  deps: EventDeps = {}
): Promise<EventSummary[]> {
  const store = deps.store ?? getStore();
  const chain = deps.chain ?? getChain();
  const visible = (await store.listEvents())
    .filter((e) => e.visibility === "public" || e.hostWallet === viewer?.wallet)
    .slice(0, 100);
  let onchain: (OnChainEvent | null)[];
  try {
    onchain = await chain.getEvents(visible.map((e) => e.eventPda));
  } catch (err) {
    console.error("RPC error listing events", err);
    onchain = visible.map(() => null);
  }
  return visible.map((e, i) => toSummary(e, onchain[i]));
}

/** GET /api/events/[pda]: stored summary merged with on-chain fee/capacity/sold/status. */
export async function getEventSummary(
  pda: string,
  viewer: AuthContext | null,
  deps: EventDeps = {}
): Promise<EventSummary> {
  assertPda(pda);
  const store = deps.store ?? getStore();
  const chain = deps.chain ?? getChain();
  const stored = await store.getEvent(pda);
  // Network-visibility events are 404 to anyone but the host until T50 adds the graph check.
  if (
    !stored ||
    (stored.visibility !== "public" && stored.hostWallet !== viewer?.wallet)
  ) {
    throw new ApiError(404, "Event not found");
  }
  let onchain: OnChainEvent | null = null;
  try {
    onchain = await chain.getEvent(pda);
  } catch (err) {
    console.error("RPC error reading event", err);
  }
  return toSummary(stored, onchain);
}

export interface EventDetails {
  eventPda: string;
  title: string;
  summary: string;
  coverUrl: string | null;
  details: unknown;
}

/** GET /api/events/[pda]/details: host or ticket holder only. */
export async function getEventDetails(
  pda: string,
  auth: AuthContext,
  deps: EventDeps = {}
): Promise<EventDetails> {
  assertPda(pda);
  const store = deps.store ?? getStore();
  const chain = deps.chain ?? getChain();
  const stored = await store.getEvent(pda);
  if (!stored) throw new ApiError(404, "Event not found");
  if (stored.hostWallet !== auth.wallet) {
    let hasTicket: boolean;
    try {
      hasTicket = await chain.ticketExists(pda, auth.wallet);
    } catch (err) {
      console.error("RPC error checking ticket", err);
      throw new ApiError(502, "Could not verify ticket on the chain");
    }
    if (!hasTicket) {
      throw new ApiError(403, "A ticket for this event is required");
    }
  }
  return {
    eventPda: stored.eventPda,
    title: stored.title,
    summary: stored.summary,
    coverUrl: stored.coverUrl,
    details: stored.details,
  };
}
