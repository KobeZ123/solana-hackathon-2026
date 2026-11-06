import { describe, expect, it } from "vitest";
import { EventStatus } from "../../generated/event_pool";
import { eventPhase, eventStatusLabel, joinBlocker } from "./status";

const base = {
  status: EventStatus.Open,
  capacity: 2,
  ticketsSold: 1,
  startTs: 1000n,
  endTs: 2000n,
};

describe("status helpers", () => {
  it("labels statuses", () => {
    expect(eventStatusLabel(EventStatus.Open)).toBe("Open");
    expect(eventStatusLabel(EventStatus.Ended)).toBe("Ended");
    expect(eventStatusLabel(EventStatus.Cancelled)).toBe("Cancelled");
  });

  it("computes join blockers", () => {
    expect(joinBlocker(base, 1500)).toBeNull();
    expect(joinBlocker({ ...base, ticketsSold: 2 }, 1500)).toBe("sold_out");
    expect(joinBlocker(base, 2000)).toBe("ended");
    expect(joinBlocker({ ...base, status: EventStatus.Ended }, 1500)).toBe(
      "ended"
    );
    expect(joinBlocker({ ...base, status: EventStatus.Cancelled }, 1500)).toBe(
      "cancelled"
    );
  });

  it("computes phase", () => {
    expect(eventPhase(base, 500)).toBe("upcoming");
    expect(eventPhase(base, 1000)).toBe("live");
    expect(eventPhase(base, 2000)).toBe("over");
  });
});
