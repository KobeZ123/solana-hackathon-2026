import { describe, expect, it } from "vitest";
import { createCheckinPayload, encodePayload, generateTicketKey } from "../qr";
import { buildTicketCache, decideScan } from "./scan";
import {
  TICKET_EVENT_OFFSET,
  TICKET_MEMBER_OFFSET,
  ticketsByEventFilters,
  ticketsByMemberFilters,
} from "./tickets-chain";
import { TICKET_DISCRIMINATOR } from "../../generated/event_pool";
import { toBase58 } from "../qr/base58";
import { generateGateKey, loadGateKey, saveGateKey } from "./gate-key";
import type { Address } from "@solana/kit";

const EVENT = "E4SJunPXu5ZyoiSpz9Nk4jUAQWjj7qif6fTBDjR1Ping";
const MEMBER = "11111111111111111111111111111112";
const NOW = 1_800_000_000;

function setup(checkedIn = false) {
  const key = generateTicketKey();
  const cache = buildTicketCache([
    { member: MEMBER, ticketKey: key.publicKey, checkedIn },
  ]);
  const qr = (over: { ts?: number; event?: string; secret?: string } = {}) =>
    encodePayload(
      createCheckinPayload({
        event: over.event ?? EVENT,
        member: MEMBER,
        secretKey: over.secret ?? key.secretKey,
        ts: over.ts ?? NOW,
      })
    );
  return { key, cache, qr };
}

describe("decideScan", () => {
  it("accepts a fresh valid payload", () => {
    const { cache, qr } = setup();
    expect(decideScan({ text: qr(), event: EVENT, cache, now: NOW })).toEqual({
      kind: "ok",
      member: MEMBER,
    });
  });

  it("rejects non-ticket text as malformed", () => {
    const { cache } = setup();
    for (const text of ["hello", "{}", '{"v":2}']) {
      expect(decideScan({ text, event: EVENT, cache, now: NOW })).toEqual({
        kind: "reject",
        reason: "malformed",
      });
    }
  });

  it("rejects a ticket for another event", () => {
    const { cache, qr } = setup();
    const d = decideScan({
      text: qr({ event: MEMBER }),
      event: EVENT,
      cache,
      now: NOW,
    });
    expect(d).toMatchObject({ kind: "reject", reason: "wrong_event" });
  });

  it("rejects unknown tickets", () => {
    const { qr } = setup();
    const d = decideScan({
      text: qr(),
      event: EVENT,
      cache: new Map(),
      now: NOW,
    });
    expect(d).toMatchObject({ kind: "reject", reason: "unknown_ticket" });
  });

  it("rejects stale and future payloads distinctly", () => {
    const { cache, qr } = setup();
    expect(
      decideScan({ text: qr({ ts: NOW - 31 }), event: EVENT, cache, now: NOW })
    ).toMatchObject({ reason: "stale" });
    expect(
      decideScan({ text: qr({ ts: NOW + 30 }), event: EVENT, cache, now: NOW })
    ).toMatchObject({ reason: "future" });
    // boundary: exactly 30 s old is still fine
    expect(
      decideScan({ text: qr({ ts: NOW - 30 }), event: EVENT, cache, now: NOW })
    ).toMatchObject({ kind: "ok" });
  });

  it("rejects a signature from the wrong key", () => {
    const { cache, qr } = setup();
    const other = generateTicketKey();
    const d = decideScan({
      text: qr({ secret: other.secretKey }),
      event: EVENT,
      cache,
      now: NOW,
    });
    expect(d).toMatchObject({ kind: "reject", reason: "bad_signature" });
  });

  it("rejects already checked in (on-chain or this session)", () => {
    const chain = setup(true);
    expect(
      decideScan({
        text: chain.qr(),
        event: EVENT,
        cache: chain.cache,
        now: NOW,
      })
    ).toMatchObject({ reason: "already_checked_in" });
    const local = setup(false);
    expect(
      decideScan({
        text: local.qr(),
        event: EVENT,
        cache: local.cache,
        now: NOW,
        checkedInLocally: new Set([MEMBER]),
      })
    ).toMatchObject({ reason: "already_checked_in" });
  });
});

describe("ticket memcmp filters", () => {
  it("filters by discriminator at 0 and event at offset 8", () => {
    const f = ticketsByEventFilters(EVENT as Address);
    expect(f).toHaveLength(2);
    expect(f[0].memcmp.offset).toBe(0n);
    expect(f[0].memcmp.bytes).toBe(toBase58(TICKET_DISCRIMINATOR));
    expect(f[1].memcmp.offset).toBe(TICKET_EVENT_OFFSET);
    expect(TICKET_EVENT_OFFSET).toBe(8n);
    expect(f[1].memcmp.bytes).toBe(EVENT);
  });

  it("filters by member at offset 40", () => {
    const f = ticketsByMemberFilters(MEMBER as Address);
    expect(f[1].memcmp.offset).toBe(TICKET_MEMBER_OFFSET);
    expect(TICKET_MEMBER_OFFSET).toBe(40n);
    expect(f[1].memcmp.bytes).toBe(MEMBER);
  });
});

describe("gate key storage", () => {
  it("returns null / false when localStorage is unavailable", () => {
    const g = globalThis as unknown as { window?: unknown };
    const prev = g.window;
    g.window = {
      localStorage: {
        getItem() {
          throw new Error("denied");
        },
        setItem() {
          throw new Error("denied");
        },
      },
    };
    try {
      expect(saveGateKey(EVENT, generateGateKey())).toBe(false);
      expect(loadGateKey(EVENT)).toBeNull();
    } finally {
      g.window = prev;
    }
  });

  it("round-trips through storage", () => {
    const store = new Map<string, string>();
    const g = globalThis as unknown as { window?: unknown };
    const prev = g.window;
    g.window = {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
      },
    };
    try {
      const key = generateGateKey();
      expect(saveGateKey(EVENT, key)).toBe(true);
      expect(loadGateKey(EVENT)).toEqual(key);
      expect(loadGateKey("other")).toBeNull();
    } finally {
      g.window = prev;
    }
  });
});
