import { describe, expect, it } from "vitest";
import {
  createCheckinPayload,
  createDeliveryPayload,
  decodeAnyPayload,
  decodePayload,
  deliveryMessage,
  encodeDeliveryPayload,
  encodePayload,
  generateTicketKey,
  generateVendorKey,
  verifyCheckinPayload,
  verifyDeliveryPayload,
} from "./index";

const EVENT = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const VENDOR = "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV";
const NOW = 1_730_000_000;

function setup() {
  const key = generateVendorKey();
  const payload = createDeliveryPayload({
    event: EVENT,
    vendor: VENDOR,
    secretKey: key.secretKey,
    ts: NOW,
  });
  return { key, payload };
}

describe("delivery payload", () => {
  it("uses the delivery: message prefix", () => {
    expect(new TextDecoder().decode(deliveryMessage(EVENT, VENDOR, 5))).toBe(
      `delivery:${EVENT}:${VENDOR}:5`
    );
  });

  it("verifies a fresh payload with pinned event/vendor", () => {
    const { key, payload } = setup();
    expect(
      verifyDeliveryPayload(payload, key.publicKey, {
        now: NOW + 10,
        event: EVENT,
        vendor: VENDOR,
      })
    ).toEqual({ ok: true });
  });

  it("rejects expired, future, tampered, wrong key, wrong event/vendor", () => {
    const { key, payload } = setup();
    const v = (p = payload, k = key.publicKey, o = {}) =>
      verifyDeliveryPayload(p, k, { now: NOW, ...o });
    expect(
      verifyDeliveryPayload(payload, key.publicKey, { now: NOW + 31 })
    ).toMatchObject({ ok: false, reason: "expired" });
    expect(
      verifyDeliveryPayload(payload, key.publicKey, { now: NOW - 6 })
    ).toMatchObject({ ok: false, reason: "future" });
    expect(v({ ...payload, vendor: EVENT })).toMatchObject({
      reason: "bad_signature",
    });
    expect(v(payload, generateVendorKey().publicKey)).toMatchObject({
      reason: "bad_signature",
    });
    expect(v(payload, key.publicKey, { event: VENDOR })).toMatchObject({
      reason: "wrong_event",
    });
    expect(v(payload, key.publicKey, { vendor: EVENT })).toMatchObject({
      reason: "wrong_vendor",
    });
    expect(v({ ...payload, ts: "x" } as never)).toMatchObject({
      reason: "malformed",
    });
  });

  it("a ticket signature cannot be replayed as a delivery and vice versa", () => {
    const tk = generateTicketKey();
    const checkin = createCheckinPayload({
      event: EVENT,
      member: VENDOR,
      secretKey: tk.secretKey,
      ts: NOW,
    });
    const asDelivery = {
      v: 1 as const,
      event: EVENT,
      vendor: VENDOR,
      ts: NOW,
      sig: checkin.sig,
    };
    expect(
      verifyDeliveryPayload(asDelivery, tk.publicKey, { now: NOW })
    ).toMatchObject({ ok: false, reason: "bad_signature" });

    const { key, payload } = setup();
    const asCheckin = { ...payload, member: VENDOR, vendor: undefined };
    expect(
      verifyCheckinPayload(asCheckin as never, key.publicKey, { now: NOW })
    ).toMatchObject({ ok: false });
  });

  it("decodeAnyPayload classifies ticket and delivery payloads", () => {
    const { key, payload } = setup();
    const tk = generateTicketKey();
    const checkin = createCheckinPayload({
      event: EVENT,
      member: VENDOR,
      secretKey: tk.secretKey,
      ts: NOW,
    });
    expect(decodeAnyPayload(encodeDeliveryPayload(payload))).toEqual({
      kind: "delivery",
      payload,
    });
    expect(decodeAnyPayload(encodePayload(checkin))).toEqual({
      kind: "checkin",
      payload: checkin,
    });
    expect(decodeAnyPayload("nope")).toBeNull();
    // backwards compatible: the ticket decoder still ignores delivery payloads
    expect(decodePayload(encodeDeliveryPayload(payload))).toBeNull();
    void key;
  });
});
