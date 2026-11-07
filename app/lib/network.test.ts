import { describe, expect, it } from "vitest";
import { parseNetwork, unlockNudge } from "./network";
import { parseEventList } from "./event-summary";

describe("parseNetwork", () => {
  it("parses the API shape and tolerates junk", () => {
    const n = parseNetwork({
      peers: [
        {
          wallet: "A",
          strong: true,
          sharedEvents: [
            { eventPda: "E1", title: "Party", strong: true },
            { eventPda: "E2", title: null, strong: false },
            { nope: 1 },
          ],
        },
        { strong: true },
        null,
      ],
      totals: { connections: 1, strong: 1, weak: 0, eventsAttended: 3 },
      unlockable: 4,
      nextUnlock: { eventPda: "E9", title: "Next", unlocks: 2 },
    });
    expect(n.peers).toHaveLength(1);
    expect(n.peers[0].sharedCount).toBe(2);
    expect(n.peers[0].sharedEvents[1].title).toBeNull();
    expect(n.totals).toMatchObject({ connections: 1, checkedIn: 0 });
    expect(n.unlockable).toBe(4);
    expect(parseNetwork(undefined).peers).toEqual([]);
    expect(parseNetwork("x").nextUnlock).toBeNull();
  });
});

describe("unlockNudge", () => {
  const base = parseNetwork({});
  it("is null with nothing to unlock", () => {
    expect(unlockNudge(base)).toBeNull();
  });
  it("pluralises from the API numbers", () => {
    const mk = (unlocks: number) =>
      unlockNudge({
        ...base,
        nextUnlock: { eventPda: "E", title: "T", unlocks },
      });
    expect(mk(1)).toBe("Attend 1 more event to unlock 1 event");
    expect(mk(3)).toBe("Attend 1 more event to unlock 3 events");
  });
});

describe("parseEventList via", () => {
  it("reads the connecting event", () => {
    const [a, b] = parseEventList([
      {
        eventPda: "A",
        title: "t",
        via: { eventPda: "E1", title: "Meetup", strong: true },
      },
      { eventPda: "B", title: "t", via: null },
    ]);
    expect(a.via).toEqual({ eventPda: "E1", title: "Meetup", strong: true });
    expect(b.via).toBeUndefined();
  });
});
