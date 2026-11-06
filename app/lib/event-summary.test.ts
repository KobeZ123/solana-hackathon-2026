import { describe, expect, it } from "vitest";
import { parseEventList } from "./event-summary";

describe("parseEventList", () => {
  it("accepts a bare array and an { events } wrapper", () => {
    const row = { eventPda: "A", title: "T" };
    expect(parseEventList([row])).toHaveLength(1);
    expect(parseEventList({ events: [row] })).toHaveLength(1);
  });

  it("returns [] for junk", () => {
    expect(parseEventList(null)).toEqual([]);
    expect(parseEventList("x")).toEqual([]);
    expect(parseEventList({ events: "no" })).toEqual([]);
    expect(parseEventList([1, null, {}, { title: "no pda" }])).toEqual([]);
  });

  it("reads camelCase, snake_case and nested chain fields", () => {
    const [a, b] = parseEventList([
      {
        eventPda: "A",
        title: "Party",
        summary: "fun",
        coverUrl: "https://x/y.png",
        entryFee: "50000000",
        capacity: 10,
        ticketsSold: "3",
        startTs: 1730000000,
      },
      {
        event_pda: "B",
        onchain: { entry_fee: 1000000, capacity: 5, tickets_sold: 1 },
      },
    ]);
    expect(a).toMatchObject({
      pda: "A",
      title: "Party",
      entryFee: 50_000_000n,
      capacity: 10,
      ticketsSold: 3,
      startTs: 1730000000,
    });
    expect(b).toMatchObject({
      pda: "B",
      title: "Untitled event",
      entryFee: 1_000_000n,
      capacity: 5,
      ticketsSold: 1,
    });
  });
});
