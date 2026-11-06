import { EventStatus } from "../../generated/event_pool";

export function eventStatusLabel(status: EventStatus): string {
  switch (status) {
    case EventStatus.Open:
      return "Open";
    case EventStatus.Ended:
      return "Ended";
    case EventStatus.Cancelled:
      return "Cancelled";
    default:
      return "Unknown";
  }
}

type EventLike = {
  status: EventStatus;
  capacity: number;
  ticketsSold: number;
  startTs: bigint;
  endTs: bigint;
};

export type JoinBlocker = "cancelled" | "ended" | "sold_out" | null;

/** Why a new member cannot join right now (mirrors `join_event` rules), or null if they can. */
export function joinBlocker(
  event: EventLike,
  nowSecs: number = Math.floor(Date.now() / 1000)
): JoinBlocker {
  if (event.status === EventStatus.Cancelled) return "cancelled";
  if (event.status !== EventStatus.Open || BigInt(nowSecs) >= event.endTs) {
    return "ended";
  }
  if (event.ticketsSold >= event.capacity) return "sold_out";
  return null;
}

/** Human phase for display: upcoming / live / over, independent of the on-chain status. */
export function eventPhase(
  event: Pick<EventLike, "startTs" | "endTs">,
  nowSecs: number = Math.floor(Date.now() / 1000)
): "upcoming" | "live" | "over" {
  const now = BigInt(nowSecs);
  if (now < event.startTs) return "upcoming";
  if (now < event.endTs) return "live";
  return "over";
}
