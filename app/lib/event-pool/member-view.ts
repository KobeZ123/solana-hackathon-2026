import { EventStatus } from "../../generated/event_pool";
import { settledPayout } from "./payout";

/** What a member can do with their ticket right now. Amounts are lamports. */
export type MemberView =
  /** No Ticket account (never joined, or already refunded). */
  | { kind: "no_ticket" }
  /** Event still Open: payouts not decided yet. */
  | { kind: "open" }
  /** Ended, checked in, not yet claimed: `claim` pays `amount`. */
  | { kind: "claimable"; amount: bigint }
  | { kind: "claimed"; amount: bigint }
  /** Ended but the member never checked in: no payout. */
  | { kind: "not_checked_in" }
  /** Cancelled with a live ticket: `refund` pays the entry fee. */
  | { kind: "refundable"; amount: bigint };

type EventLike = {
  status: EventStatus;
  entryFee: bigint;
  attendeePool: bigint;
  hostBudget: bigint;
  checkedIn: number;
  approvedSponsorTotal: bigint;
};

type TicketLike = { checkedIn: boolean; claimed: boolean };

/** Pure state machine behind the claim page and the My tickets call to action. */
export function memberView(
  event: EventLike,
  ticket: TicketLike | null | undefined
): MemberView {
  if (!ticket) return { kind: "no_ticket" };
  switch (event.status) {
    case EventStatus.Cancelled:
      return { kind: "refundable", amount: event.entryFee };
    case EventStatus.Ended: {
      if (!ticket.checkedIn) return { kind: "not_checked_in" };
      const amount = settledPayout(event).perAttendee;
      return ticket.claimed
        ? { kind: "claimed", amount }
        : { kind: "claimable", amount };
    }
    default:
      return { kind: "open" };
  }
}
