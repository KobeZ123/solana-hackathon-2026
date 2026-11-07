import { describe, expect, it } from "vitest";
import { EventStatus } from "../../generated/event_pool";
import { memberView } from "./member-view";

const event = {
  status: EventStatus.Ended,
  entryFee: 100_000_000n,
  attendeePool: 90_000_000n,
  hostBudget: 210_000_000n,
  checkedIn: 2,
  approvedSponsorTotal: 0n,
};

describe("memberView", () => {
  it("no ticket", () => {
    expect(memberView(event, null)).toEqual({ kind: "no_ticket" });
    expect(memberView(event, undefined)).toEqual({ kind: "no_ticket" });
  });

  it("open event: payouts not decided", () => {
    expect(
      memberView(
        { ...event, status: EventStatus.Open },
        { checkedIn: true, claimed: false }
      )
    ).toEqual({ kind: "open" });
  });

  it("ended + checked in + unclaimed is claimable for attendee_pool / checked_in", () => {
    expect(memberView(event, { checkedIn: true, claimed: false })).toEqual({
      kind: "claimable",
      amount: 45_000_000n,
    });
  });

  it("integer division floors the share (dust stays with the host)", () => {
    expect(
      memberView(
        { ...event, attendeePool: 100n, checkedIn: 3 },
        { checkedIn: true, claimed: false }
      )
    ).toEqual({ kind: "claimable", amount: 33n });
  });

  it("claimed", () => {
    expect(memberView(event, { checkedIn: true, claimed: true })).toEqual({
      kind: "claimed",
      amount: 45_000_000n,
    });
  });

  it("ended but never checked in", () => {
    expect(memberView(event, { checkedIn: false, claimed: false })).toEqual({
      kind: "not_checked_in",
    });
  });

  it("cancelled with a ticket is refundable for the entry fee, checked in or not", () => {
    const cancelled = { ...event, status: EventStatus.Cancelled };
    for (const t of [
      { checkedIn: false, claimed: false },
      { checkedIn: true, claimed: false },
    ]) {
      expect(memberView(cancelled, t)).toEqual({
        kind: "refundable",
        amount: 100_000_000n,
      });
    }
    expect(memberView(cancelled, null)).toEqual({ kind: "no_ticket" });
  });
});
