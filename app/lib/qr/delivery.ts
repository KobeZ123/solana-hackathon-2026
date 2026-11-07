import nacl from "tweetnacl";
import { QR_MAX_AGE_SECS } from "../config";
import { fromBase58, toBase58 } from "./base58";
import {
  decodePayload,
  QR_MAX_FUTURE_SKEW_SECS,
  type CheckinPayload,
} from "./payload";

/**
 * Vendor delivery QR payload (stretch A): same shape as the ticket payload with `vendor`
 * in place of `member` and message prefix `delivery:`. Signed by `VendorProfile.vendor_key`.
 */
export type DeliveryPayload = {
  v: 1;
  event: string;
  vendor: string;
  ts: number;
  sig: string;
};

export type DeliveryVerifyResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "malformed"
        | "expired"
        | "future"
        | "bad_signature"
        | "wrong_event"
        | "wrong_vendor";
    };

const encoder = new TextEncoder();
const nowSecs = () => Math.floor(Date.now() / 1000);

export function deliveryMessage(
  event: string,
  vendor: string,
  ts: number
): Uint8Array {
  return encoder.encode(`delivery:${event}:${vendor}:${ts}`);
}

export function createDeliveryPayload(args: {
  event: string;
  vendor: string;
  secretKey: string;
  ts?: number;
}): DeliveryPayload {
  const ts = args.ts ?? nowSecs();
  const sig = nacl.sign.detached(
    deliveryMessage(args.event, args.vendor, ts),
    fromBase58(args.secretKey)
  );
  return {
    v: 1,
    event: args.event,
    vendor: args.vendor,
    ts,
    sig: toBase58(sig),
  };
}

export function isDeliveryPayload(value: unknown): value is DeliveryPayload {
  if (!value || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  return (
    p.v === 1 &&
    typeof p.event === "string" &&
    typeof p.vendor === "string" &&
    typeof p.ts === "number" &&
    Number.isFinite(p.ts) &&
    typeof p.sig === "string"
  );
}

/** Verify against `VendorProfile.vendor_key` (base58). Never throws. */
export function verifyDeliveryPayload(
  payload: DeliveryPayload,
  vendorKey: string,
  opts: { now?: number; event?: string; vendor?: string } = {}
): DeliveryVerifyResult {
  if (!isDeliveryPayload(payload)) return { ok: false, reason: "malformed" };
  if (opts.event !== undefined && payload.event !== opts.event) {
    return { ok: false, reason: "wrong_event" };
  }
  if (opts.vendor !== undefined && payload.vendor !== opts.vendor) {
    return { ok: false, reason: "wrong_vendor" };
  }
  const now = opts.now ?? nowSecs();
  if (now - payload.ts > QR_MAX_AGE_SECS) {
    return { ok: false, reason: "expired" };
  }
  if (payload.ts - now > QR_MAX_FUTURE_SKEW_SECS) {
    return { ok: false, reason: "future" };
  }
  try {
    const sig = fromBase58(payload.sig);
    const key = fromBase58(vendorKey);
    if (
      sig.length !== nacl.sign.signatureLength ||
      key.length !== nacl.sign.publicKeyLength
    ) {
      return { ok: false, reason: "bad_signature" };
    }
    const valid = nacl.sign.detached.verify(
      deliveryMessage(payload.event, payload.vendor, payload.ts),
      sig,
      key
    );
    return valid ? { ok: true } : { ok: false, reason: "bad_signature" };
  } catch {
    return { ok: false, reason: "bad_signature" };
  }
}

export function encodeDeliveryPayload(payload: DeliveryPayload): string {
  return JSON.stringify(payload);
}

export function decodeDeliveryPayload(text: string): DeliveryPayload | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isDeliveryPayload(parsed)) return null;
    return {
      v: 1,
      event: parsed.event,
      vendor: parsed.vendor,
      ts: parsed.ts,
      sig: parsed.sig,
    };
  } catch {
    return null;
  }
}

export type ScannedPayload =
  | { kind: "checkin"; payload: CheckinPayload }
  | { kind: "delivery"; payload: DeliveryPayload };

/** Classify scanned QR text as a ticket check-in or a vendor delivery payload. */
export function decodeAnyPayload(text: string): ScannedPayload | null {
  const checkin = decodePayload(text);
  if (checkin) return { kind: "checkin", payload: checkin };
  const delivery = decodeDeliveryPayload(text);
  if (delivery) return { kind: "delivery", payload: delivery };
  return null;
}
