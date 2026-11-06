import nacl from "tweetnacl";
import { QR_MAX_AGE_SECS } from "../config";
import { fromBase58, toBase58 } from "./base58";

/** Ticket QR payload (see docs/TICKETS.md "QR payload"). `ts` is unix seconds. */
export type CheckinPayload = {
  v: 1;
  event: string;
  member: string;
  ts: number;
  sig: string;
};

/** A payload may be at most this many seconds in the future (clock skew). */
export const QR_MAX_FUTURE_SKEW_SECS = 5;

export type VerifyResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "malformed"
        | "expired"
        | "future"
        | "bad_signature"
        | "wrong_event"
        | "wrong_member";
    };

const encoder = new TextEncoder();

export function checkinMessage(
  event: string,
  member: string,
  ts: number
): Uint8Array {
  return encoder.encode(`checkin:${event}:${member}:${ts}`);
}

const nowSecs = () => Math.floor(Date.now() / 1000);

/**
 * Sign a fresh check-in payload with the ticket secret key (base58, 64 bytes).
 * `ts` defaults to the current time; pass it explicitly for tests.
 */
export function createCheckinPayload(args: {
  event: string;
  member: string;
  secretKey: string;
  ts?: number;
}): CheckinPayload {
  const ts = args.ts ?? nowSecs();
  const sig = nacl.sign.detached(
    checkinMessage(args.event, args.member, ts),
    fromBase58(args.secretKey)
  );
  return {
    v: 1,
    event: args.event,
    member: args.member,
    ts,
    sig: toBase58(sig),
  };
}

/**
 * Verify a payload against `Ticket.ticket_key` (base58 public key). Valid when
 * `now - ts <= QR_MAX_AGE_SECS`, `ts - now <= QR_MAX_FUTURE_SKEW_SECS` and the
 * ed25519 signature verifies. Optionally pins the expected event/member.
 * Never throws.
 */
export function verifyCheckinPayload(
  payload: CheckinPayload,
  ticketKey: string,
  opts: { now?: number; event?: string; member?: string } = {}
): VerifyResult {
  if (!isCheckinPayload(payload)) return { ok: false, reason: "malformed" };
  if (opts.event !== undefined && payload.event !== opts.event) {
    return { ok: false, reason: "wrong_event" };
  }
  if (opts.member !== undefined && payload.member !== opts.member) {
    return { ok: false, reason: "wrong_member" };
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
    const key = fromBase58(ticketKey);
    if (
      sig.length !== nacl.sign.signatureLength ||
      key.length !== nacl.sign.publicKeyLength
    ) {
      return { ok: false, reason: "bad_signature" };
    }
    const valid = nacl.sign.detached.verify(
      checkinMessage(payload.event, payload.member, payload.ts),
      sig,
      key
    );
    return valid ? { ok: true } : { ok: false, reason: "bad_signature" };
  } catch {
    return { ok: false, reason: "bad_signature" };
  }
}

export function isCheckinPayload(value: unknown): value is CheckinPayload {
  if (!value || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  return (
    p.v === 1 &&
    typeof p.event === "string" &&
    typeof p.member === "string" &&
    typeof p.ts === "number" &&
    Number.isFinite(p.ts) &&
    typeof p.sig === "string"
  );
}

/** Serialize for the QR code. */
export function encodePayload(payload: CheckinPayload): string {
  return JSON.stringify(payload);
}

/** Parse scanned text. Returns null for anything that is not a valid payload shape. */
export function decodePayload(text: string): CheckinPayload | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isCheckinPayload(parsed)) return null;
    return {
      v: 1,
      event: parsed.event,
      member: parsed.member,
      ts: parsed.ts,
      sig: parsed.sig,
    };
  } catch {
    return null;
  }
}
