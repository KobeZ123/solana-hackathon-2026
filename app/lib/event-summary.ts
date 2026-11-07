import { parseSharedEvent, type SharedEventInfo } from "./network";

/**
 * Tolerant parsing of `GET /api/events` for the home list. The exact response
 * shape is owned by T31; this accepts either a bare array or `{ events: [...] }`
 * and picks the fields the list needs, ignoring anything else.
 */

export type EventListItem = {
  pda: string;
  title: string;
  summary?: string;
  coverUrl?: string;
  /** Entry fee in lamports, when the API provides it. */
  entryFee?: bigint;
  capacity?: number;
  ticketsSold?: number;
  /** Unix seconds. */
  startTs?: number;
  endTs?: number;
  status?: string;
  /** Feed only: the shared event connecting you to the host ("from your network"). */
  via?: SharedEventInfo;
};

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return undefined;
}

function lamports(v: unknown): bigint | undefined {
  try {
    if (typeof v === "bigint") return v;
    if (typeof v === "number" && Number.isInteger(v)) return BigInt(v);
    if (typeof v === "string" && /^\d+$/.test(v)) return BigInt(v);
  } catch {
    /* fall through */
  }
  return undefined;
}

export function parseEventList(body: unknown): EventListItem[] {
  const raw: unknown[] = Array.isArray(body)
    ? body
    : body &&
        typeof body === "object" &&
        Array.isArray((body as { events?: unknown }).events)
      ? (body as { events: unknown[] }).events
      : [];

  const items: EventListItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    // The API may nest on-chain data under `onchain` (T31) or `chain`.
    const chain =
      (e.onchain ?? e.chain) && typeof (e.onchain ?? e.chain) === "object"
        ? ((e.onchain ?? e.chain) as Record<string, unknown>)
        : {};
    const pda = str(e.eventPda) ?? str(e.pda) ?? str(e.event_pda);
    if (!pda) continue;
    items.push({
      pda,
      title: str(e.title) ?? "Untitled event",
      summary: str(e.summary),
      coverUrl: str(e.coverUrl) ?? str(e.cover_url),
      entryFee: lamports(
        e.entryFee ?? e.entry_fee ?? chain.entryFee ?? chain.entry_fee
      ),
      capacity: num(e.capacity ?? chain.capacity),
      ticketsSold: num(
        e.ticketsSold ??
          e.tickets_sold ??
          chain.ticketsSold ??
          chain.tickets_sold
      ),
      startTs: num(e.startTs ?? e.start_ts ?? chain.startTs ?? chain.start_ts),
      endTs: num(e.endTs ?? e.end_ts ?? chain.endTs ?? chain.end_ts),
      status: str(e.status) ?? str(chain.status),
      via: parseSharedEvent(e.via) ?? undefined,
    });
  }
  return items;
}
