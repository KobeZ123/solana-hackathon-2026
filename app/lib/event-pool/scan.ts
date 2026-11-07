import {
  decodePayload,
  verifyCheckinPayload,
  type VerifyResult,
} from "../qr/payload";

/** What the scanner knows about one ticket (from `getProgramAccounts`). */
export type CachedTicket = { ticketKey: string; checkedIn: boolean };
export type TicketCache = ReadonlyMap<string, CachedTicket>;

export type RejectReason =
  | "malformed"
  | "wrong_event"
  | "stale"
  | "future"
  | "bad_signature"
  | "unknown_ticket"
  | "already_checked_in";

export type ScanDecision =
  | { kind: "ok"; member: string }
  | { kind: "reject"; reason: RejectReason; member?: string };

/**
 * Pure scan decision: scanned text + cache + clock -> accept (send check_in) or
 * a specific rejection. `checkedInLocally` holds members this session already
 * checked in (the cache may lag the chain by up to its refresh interval).
 */
export function decideScan(args: {
  text: string;
  event: string;
  cache: TicketCache;
  now: number;
  checkedInLocally?: ReadonlySet<string>;
}): ScanDecision {
  const payload = decodePayload(args.text);
  if (!payload) return { kind: "reject", reason: "malformed" };
  if (payload.event !== args.event) {
    return { kind: "reject", reason: "wrong_event", member: payload.member };
  }
  const ticket = args.cache.get(payload.member);
  if (!ticket) {
    return { kind: "reject", reason: "unknown_ticket", member: payload.member };
  }
  if (ticket.checkedIn || args.checkedInLocally?.has(payload.member)) {
    return {
      kind: "reject",
      reason: "already_checked_in",
      member: payload.member,
    };
  }
  const result: VerifyResult = verifyCheckinPayload(payload, ticket.ticketKey, {
    now: args.now,
    event: args.event,
    member: payload.member,
  });
  if (result.ok) return { kind: "ok", member: payload.member };
  const reason: RejectReason =
    result.reason === "expired"
      ? "stale"
      : result.reason === "future"
        ? "future"
        : result.reason === "malformed"
          ? "malformed"
          : result.reason === "wrong_event"
            ? "wrong_event"
            : "bad_signature";
  return { kind: "reject", reason, member: payload.member };
}

export const REJECT_COPY: Record<
  RejectReason,
  { title: string; hint: string }
> = {
  malformed: {
    title: "Not a ticket",
    hint: "This QR code is not an Event Pool ticket.",
  },
  wrong_event: {
    title: "Wrong event",
    hint: "This ticket is for a different event.",
  },
  stale: {
    title: "QR expired",
    hint: "Ask them to wait for the code to refresh and scan again.",
  },
  future: {
    title: "Clock mismatch",
    hint: "The phone's clock looks ahead. Ask them to enable automatic time.",
  },
  bad_signature: {
    title: "Invalid signature",
    hint: "This code does not match the ticket holder's key.",
  },
  unknown_ticket: {
    title: "No ticket found",
    hint: "This wallet has no ticket for this event.",
  },
  already_checked_in: {
    title: "Already checked in",
    hint: "This ticket was already used.",
  },
};

/** Build the cache map from fetched tickets. */
export function buildTicketCache(
  tickets: Iterable<{
    member: string;
    ticketKey: string;
    checkedIn: boolean;
  }>
): Map<string, CachedTicket> {
  const map = new Map<string, CachedTicket>();
  for (const t of tickets) {
    map.set(t.member, { ticketKey: t.ticketKey, checkedIn: t.checkedIn });
  }
  return map;
}
