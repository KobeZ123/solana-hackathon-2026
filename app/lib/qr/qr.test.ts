import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCheckinPayload,
  decodePayload,
  encodePayload,
  fromBase58,
  generateTicketKey,
  loadTicketKey,
  saveTicketKey,
  ticketKeyFromSecret,
  verifyCheckinPayload,
  type CheckinPayload,
} from "./index";

const EVENT = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const MEMBER = "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV";

function setup() {
  const key = generateTicketKey();
  const now = 1_730_000_000;
  const payload = createCheckinPayload({
    event: EVENT,
    member: MEMBER,
    secretKey: key.secretKey,
    ts: now,
  });
  return { key, now, payload };
}

describe("ticket keys", () => {
  it("generates base58 32-byte public and 64-byte secret keys", () => {
    const key = generateTicketKey();
    expect(fromBase58(key.publicKey)).toHaveLength(32);
    expect(fromBase58(key.secretKey)).toHaveLength(64);
    expect(ticketKeyFromSecret(key.secretKey)).toEqual(key);
  });

  it("generates distinct keys", () => {
    expect(generateTicketKey().publicKey).not.toBe(
      generateTicketKey().publicKey
    );
  });

  it("rejects a secret of the wrong length", () => {
    expect(() => ticketKeyFromSecret(EVENT)).toThrow();
  });
});

describe("checkin payload", () => {
  it("round-trips sign and verify", () => {
    const { key, now, payload } = setup();
    expect(payload.v).toBe(1);
    expect(payload.ts).toBe(now);
    expect(
      verifyCheckinPayload(payload, key.publicKey, { now: now + 1 })
    ).toEqual({ ok: true });
  });

  it("uses the current time by default", () => {
    const key = generateTicketKey();
    const p = createCheckinPayload({
      event: EVENT,
      member: MEMBER,
      secretKey: key.secretKey,
    });
    expect(verifyCheckinPayload(p, key.publicKey)).toEqual({ ok: true });
  });

  it("rejects tampered fields", () => {
    const { key, now, payload } = setup();
    const tampered: CheckinPayload[] = [
      { ...payload, event: MEMBER },
      { ...payload, member: EVENT },
      { ...payload, ts: payload.ts + 1 },
      { ...payload, sig: generateTicketKey().publicKey + "x" },
    ];
    for (const t of tampered) {
      const r = verifyCheckinPayload(t, key.publicKey, { now });
      expect(r.ok).toBe(false);
    }
    expect(
      verifyCheckinPayload({ ...payload, event: MEMBER }, key.publicKey, {
        now,
      })
    ).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a signature from the wrong key", () => {
    const { now, payload } = setup();
    const other = generateTicketKey();
    expect(verifyCheckinPayload(payload, other.publicKey, { now })).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("rejects an invalid ticket key without throwing", () => {
    const { now, payload } = setup();
    expect(verifyCheckinPayload(payload, "not-base58-0OIl", { now })).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("accepts ts exactly at the max age and rejects just beyond", () => {
    const { key, now, payload } = setup();
    expect(
      verifyCheckinPayload(payload, key.publicKey, { now: now + 30 }).ok
    ).toBe(true);
    expect(
      verifyCheckinPayload(payload, key.publicKey, { now: now + 31 })
    ).toEqual({ ok: false, reason: "expired" });
  });

  it("allows up to 5 s of future skew and rejects more", () => {
    const { key, now, payload } = setup();
    expect(
      verifyCheckinPayload(payload, key.publicKey, { now: now - 5 }).ok
    ).toBe(true);
    expect(
      verifyCheckinPayload(payload, key.publicKey, { now: now - 6 })
    ).toEqual({ ok: false, reason: "future" });
  });

  it("can pin the expected event and member", () => {
    const { key, now, payload } = setup();
    expect(
      verifyCheckinPayload(payload, key.publicKey, { now, event: MEMBER })
    ).toEqual({ ok: false, reason: "wrong_event" });
    expect(
      verifyCheckinPayload(payload, key.publicKey, { now, member: EVENT })
    ).toEqual({ ok: false, reason: "wrong_member" });
    expect(
      verifyCheckinPayload(payload, key.publicKey, {
        now,
        event: EVENT,
        member: MEMBER,
      }).ok
    ).toBe(true);
  });

  it("rejects malformed payload objects", () => {
    const { key } = setup();
    const bad = { v: 2 } as unknown as CheckinPayload;
    expect(verifyCheckinPayload(bad, key.publicKey)).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("signs the documented message format", async () => {
    const { key, payload } = setup();
    const nacl = (await import("tweetnacl")).default;
    const msg = new TextEncoder().encode(
      `checkin:${EVENT}:${MEMBER}:${payload.ts}`
    );
    expect(
      nacl.sign.detached.verify(
        msg,
        fromBase58(payload.sig),
        fromBase58(key.publicKey)
      )
    ).toBe(true);
  });
});

describe("encode/decode", () => {
  it("round-trips", () => {
    const { payload } = setup();
    expect(decodePayload(encodePayload(payload))).toEqual(payload);
  });

  it("returns null for junk and wrong shapes", () => {
    expect(decodePayload("not json")).toBeNull();
    expect(decodePayload("null")).toBeNull();
    expect(decodePayload('{"v":1,"event":"a"}')).toBeNull();
    expect(
      decodePayload('{"v":2,"event":"a","member":"b","ts":1,"sig":"c"}')
    ).toBeNull();
    expect(
      decodePayload('{"v":1,"event":"a","member":"b","ts":"1","sig":"c"}')
    ).toBeNull();
  });

  it("drops unknown extra fields", () => {
    const { payload } = setup();
    const decoded = decodePayload(
      JSON.stringify({ ...payload, extra: "x" })
    ) as unknown as Record<string, unknown>;
    expect(decoded.extra).toBeUndefined();
  });
});

function fakeStorage(overrides: Partial<Storage> = {}): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
    clear: () => data.clear(),
    key: () => null,
    get length() {
      return data.size;
    },
    ...overrides,
  };
}

describe("ticket key storage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("saves and loads per event and wallet", () => {
    vi.stubGlobal("window", { localStorage: fakeStorage() });
    const key = generateTicketKey();
    expect(saveTicketKey(EVENT, MEMBER, key)).toBe(true);
    expect(loadTicketKey(EVENT, MEMBER)).toEqual(key);
    expect(loadTicketKey(EVENT, EVENT)).toBeNull();
    expect(loadTicketKey(MEMBER, MEMBER)).toBeNull();
  });

  it("returns null for corrupt stored data", () => {
    const storage = fakeStorage();
    vi.stubGlobal("window", { localStorage: storage });
    storage.setItem(`event-pool:ticket-key:${EVENT}:${MEMBER}`, "{oops");
    expect(loadTicketKey(EVENT, MEMBER)).toBeNull();
    storage.setItem(`event-pool:ticket-key:${EVENT}:${MEMBER}`, '{"a":1}');
    expect(loadTicketKey(EVENT, MEMBER)).toBeNull();
  });

  it("does not throw when localStorage is unavailable (no window)", () => {
    vi.stubGlobal("window", undefined);
    expect(saveTicketKey(EVENT, MEMBER, generateTicketKey())).toBe(false);
    expect(loadTicketKey(EVENT, MEMBER)).toBeNull();
  });

  it("does not throw when localStorage access throws", () => {
    const boom = () => {
      throw new Error("SecurityError");
    };
    vi.stubGlobal("window", {
      localStorage: fakeStorage({ getItem: boom, setItem: boom }),
    });
    expect(saveTicketKey(EVENT, MEMBER, generateTicketKey())).toBe(false);
    expect(loadTicketKey(EVENT, MEMBER)).toBeNull();
  });

  it("does not throw when the localStorage accessor itself throws", () => {
    vi.stubGlobal("window", {
      get localStorage(): Storage {
        throw new Error("blocked");
      },
    });
    expect(saveTicketKey(EVENT, MEMBER, generateTicketKey())).toBe(false);
    expect(loadTicketKey(EVENT, MEMBER)).toBeNull();
  });
});
