import { describe, expect, it } from "vitest";
import { SponsorshipStatus } from "../../generated/event_pool";
import { createDeliveryPayload, encodeDeliveryPayload } from "../qr/delivery";
import { generateVendorKey } from "../qr/vendor-key";
import {
  budgetCheck,
  decideDelivery,
  maxHostBudget,
  offerHashToHex,
  sponsorshipStatusLabel,
  type CachedSponsorship,
} from "./vendor";
import type { Address } from "@solana/kit";

const EVENT = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const VENDOR = "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV";
const NOW = 1_800_000_000;

describe("budget cap", () => {
  it("matches the program: pool * (10000 - bps) / 10000", () => {
    expect(maxHostBudget(30_000_030n, 3000)).toBe(21_000_021n);
    expect(maxHostBudget(0n, 3000)).toBe(0n);
    expect(maxHostBudget(1000n, 10_000)).toBe(0n);
  });

  it("reports remaining and whether an amount would exceed the cap", () => {
    const base = { pool: 1000n, payoutBps: 3000, approvedSponsorTotal: 600n };
    expect(budgetCheck({ ...base, amount: 100n })).toEqual({
      cap: 700n,
      approved: 600n,
      remaining: 100n,
      exceeds: false,
    });
    expect(budgetCheck({ ...base, amount: 101n }).exceeds).toBe(true);
    // over-reserved (pool shrank is impossible, but stay safe): remaining clamps to 0
    expect(
      budgetCheck({ ...base, approvedSponsorTotal: 900n, amount: 1n })
    ).toMatchObject({ remaining: 0n, exceeds: true });
  });
});

describe("labels and hashes", () => {
  it("labels every status", () => {
    expect(sponsorshipStatusLabel(SponsorshipStatus.Proposed)).toBe("Proposed");
    expect(sponsorshipStatusLabel(SponsorshipStatus.Paid)).toBe("Paid");
    expect(sponsorshipStatusLabel(SponsorshipStatus.Rejected)).toBe("Rejected");
  });
  it("hex-encodes offer hashes", () => {
    expect(offerHashToHex(new Uint8Array([0, 15, 255]))).toBe("000fff");
  });
});

describe("decideDelivery", () => {
  const key = generateVendorKey();
  const sp = (status: SponsorshipStatus): CachedSponsorship => ({
    address: "SponsorPda1111111111111111111111111111111111" as Address,
    status,
    amount: 5n,
  });
  const text = (
    over: { ts?: number; secretKey?: string; event?: string } = {}
  ) =>
    encodeDeliveryPayload(
      createDeliveryPayload({
        event: over.event ?? EVENT,
        vendor: VENDOR,
        secretKey: over.secretKey ?? key.secretKey,
        ts: over.ts ?? NOW,
      })
    );
  const run = (
    t: string,
    status = SponsorshipStatus.Approved,
    extra: {
      keys?: Map<string, string>;
      delivered?: Set<string>;
      omit?: boolean;
    } = {}
  ) =>
    decideDelivery({
      text: t,
      event: EVENT,
      sponsorships: extra.omit ? new Map() : new Map([[VENDOR, sp(status)]]),
      vendorKeys: extra.keys ?? new Map([[VENDOR, key.publicKey]]),
      now: NOW + 3,
      deliveredLocally: extra.delivered,
    });

  it("accepts a fresh payload for an Approved sponsorship", () => {
    expect(run(text())).toMatchObject({
      kind: "ok",
      vendor: VENDOR,
      amount: 5n,
    });
  });

  it("rejects malformed, wrong event, unknown sponsorship, bad status", () => {
    expect(run("hello")).toMatchObject({ reason: "malformed" });
    expect(run(text({ event: VENDOR }))).toMatchObject({
      reason: "wrong_event",
    });
    expect(
      run(text(), SponsorshipStatus.Approved, { omit: true })
    ).toMatchObject({
      reason: "no_sponsorship",
    });
    expect(run(text(), SponsorshipStatus.Proposed)).toMatchObject({
      reason: "not_approved",
    });
    expect(run(text(), SponsorshipStatus.Rejected)).toMatchObject({
      reason: "not_approved",
    });
    expect(run(text(), SponsorshipStatus.Delivered)).toMatchObject({
      reason: "already_delivered",
    });
    expect(run(text(), SponsorshipStatus.Paid)).toMatchObject({
      reason: "already_delivered",
    });
    expect(
      run(text(), SponsorshipStatus.Approved, { delivered: new Set([VENDOR]) })
    ).toMatchObject({ reason: "already_delivered" });
  });

  it("rejects stale, future, wrong-key and missing-profile payloads", () => {
    expect(run(text({ ts: NOW - 60 }))).toMatchObject({ reason: "stale" });
    expect(run(text({ ts: NOW + 60 }))).toMatchObject({ reason: "future" });
    expect(
      run(text({ secretKey: generateVendorKey().secretKey }))
    ).toMatchObject({
      reason: "bad_signature",
    });
    expect(
      run(text(), SponsorshipStatus.Approved, { keys: new Map() })
    ).toMatchObject({ reason: "no_vendor_profile" });
  });
});
