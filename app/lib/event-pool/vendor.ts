import {
  getBase64Encoder,
  type Address,
  type GetProgramAccountsApi,
  type Rpc,
} from "@solana/kit";
import {
  SPONSORSHIP_DISCRIMINATOR,
  SponsorshipStatus,
  getSponsorshipDecoder,
  type Sponsorship,
} from "../../generated/event_pool";
import { PROGRAM_ID } from "../config";
import { toBase58 } from "../qr/base58";
import {
  decodeDeliveryPayload,
  verifyDeliveryPayload,
  type DeliveryPayload,
} from "../qr/delivery";
import { memcmp, type MemcmpFilter } from "./tickets-chain";

/** Stretch A helpers: sponsorship reads, budget-cap math and the delivery scan decision. */

/** Sponsorship layout: 8-byte discriminator, `event` at 8, `vendor` at 40. */
export const SPONSORSHIP_EVENT_OFFSET = 8n;
export const SPONSORSHIP_VENDOR_OFFSET = 40n;

const SPONSORSHIP_DISC_FILTER = memcmp(0n, toBase58(SPONSORSHIP_DISCRIMINATOR));

export type SponsorshipRecord = { address: Address; data: Sponsorship };

type SponsorshipRpc = Rpc<GetProgramAccountsApi>;

async function fetchSponsorships(
  rpc: SponsorshipRpc,
  filters: MemcmpFilter[]
): Promise<SponsorshipRecord[]> {
  const accounts = await rpc
    .getProgramAccounts(PROGRAM_ID, { encoding: "base64", filters })
    .send();
  const decoder = getSponsorshipDecoder();
  const b64 = getBase64Encoder();
  const out: SponsorshipRecord[] = [];
  for (const acc of accounts) {
    try {
      out.push({
        address: acc.pubkey,
        data: decoder.decode(b64.encode(acc.account.data[0])),
      });
    } catch {
      /* not a decodable Sponsorship: skip */
    }
  }
  return out;
}

export function fetchEventSponsorships(rpc: SponsorshipRpc, event: Address) {
  return fetchSponsorships(rpc, [
    SPONSORSHIP_DISC_FILTER,
    memcmp(SPONSORSHIP_EVENT_OFFSET, event),
  ]);
}

export function fetchVendorSponsorships(rpc: SponsorshipRpc, vendor: Address) {
  return fetchSponsorships(rpc, [
    SPONSORSHIP_DISC_FILTER,
    memcmp(SPONSORSHIP_VENDOR_OFFSET, vendor),
  ]);
}

/**
 * Host budget cap the program enforces on approval:
 * `pool * (10000 - payout_bps) / 10000` with `pool = vault - rent minimum`.
 */
export function maxHostBudget(pool: bigint, payoutBps: number): bigint {
  return (pool * BigInt(10_000 - payoutBps)) / 10_000n;
}

export type BudgetCheck = {
  cap: bigint;
  approved: bigint;
  /** cap - approved, never negative. */
  remaining: bigint;
  /** True when approving `amount` now would fail with SponsorshipBudgetExceeded. */
  exceeds: boolean;
};

/** Cap/remaining for a candidate approval (the pool can still grow before the event ends). */
export function budgetCheck(args: {
  pool: bigint;
  payoutBps: number;
  approvedSponsorTotal: bigint;
  amount: bigint;
}): BudgetCheck {
  const cap = maxHostBudget(args.pool, args.payoutBps);
  const remaining =
    cap > args.approvedSponsorTotal ? cap - args.approvedSponsorTotal : 0n;
  return {
    cap,
    approved: args.approvedSponsorTotal,
    remaining,
    exceeds: args.approvedSponsorTotal + args.amount > cap,
  };
}

export function sponsorshipStatusLabel(s: SponsorshipStatus): string {
  switch (s) {
    case SponsorshipStatus.Proposed:
      return "Proposed";
    case SponsorshipStatus.Approved:
      return "Approved";
    case SponsorshipStatus.Delivered:
      return "Delivered";
    case SponsorshipStatus.Paid:
      return "Paid";
    case SponsorshipStatus.Rejected:
      return "Rejected";
  }
}

/** Hex form of an on-chain `offer_hash`. */
export function offerHashToHex(hash: Uint8Array | readonly number[]): string {
  return Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------- delivery scan

export type DeliveryRejectReason =
  | "malformed"
  | "wrong_event"
  | "no_sponsorship"
  | "not_approved"
  | "already_delivered"
  | "no_vendor_profile"
  | "stale"
  | "future"
  | "bad_signature";

export type DeliveryDecision =
  | { kind: "ok"; vendor: string; sponsorship: Address; amount: bigint }
  | { kind: "reject"; reason: DeliveryRejectReason; vendor?: string };

export type CachedSponsorship = {
  address: Address;
  status: SponsorshipStatus;
  amount: bigint;
};

/**
 * Pure delivery-scan decision. `sponsorships` maps vendor wallet -> its sponsorship for
 * this event, `vendorKeys` maps vendor wallet -> `VendorProfile.vendor_key`.
 * `deliveredLocally` holds vendors confirmed this session (the cache may lag the chain).
 */
export function decideDelivery(args: {
  text: string;
  event: string;
  sponsorships: ReadonlyMap<string, CachedSponsorship>;
  vendorKeys: ReadonlyMap<string, string>;
  now: number;
  deliveredLocally?: ReadonlySet<string>;
}): DeliveryDecision {
  const payload: DeliveryPayload | null = decodeDeliveryPayload(args.text);
  if (!payload) return { kind: "reject", reason: "malformed" };
  const vendor = payload.vendor;
  if (payload.event !== args.event) {
    return { kind: "reject", reason: "wrong_event", vendor };
  }
  const sp = args.sponsorships.get(vendor);
  if (!sp) return { kind: "reject", reason: "no_sponsorship", vendor };
  if (
    sp.status === SponsorshipStatus.Delivered ||
    sp.status === SponsorshipStatus.Paid ||
    args.deliveredLocally?.has(vendor)
  ) {
    return { kind: "reject", reason: "already_delivered", vendor };
  }
  if (sp.status !== SponsorshipStatus.Approved) {
    return { kind: "reject", reason: "not_approved", vendor };
  }
  const key = args.vendorKeys.get(vendor);
  if (!key) return { kind: "reject", reason: "no_vendor_profile", vendor };
  const result = verifyDeliveryPayload(payload, key, {
    now: args.now,
    event: args.event,
    vendor,
  });
  if (result.ok) {
    return { kind: "ok", vendor, sponsorship: sp.address, amount: sp.amount };
  }
  const reason: DeliveryRejectReason =
    result.reason === "expired"
      ? "stale"
      : result.reason === "future"
        ? "future"
        : result.reason === "malformed"
          ? "malformed"
          : result.reason === "wrong_event"
            ? "wrong_event"
            : "bad_signature";
  return { kind: "reject", reason, vendor };
}

export const DELIVERY_REJECT_COPY: Record<
  DeliveryRejectReason,
  { title: string; hint: string }
> = {
  malformed: {
    title: "Not a vendor pass",
    hint: "This QR code is not an Event Pool vendor delivery pass.",
  },
  wrong_event: {
    title: "Wrong event",
    hint: "This vendor pass is for a different event.",
  },
  no_sponsorship: {
    title: "No sponsorship",
    hint: "This vendor has no sponsorship for this event.",
  },
  not_approved: {
    title: "Not approved",
    hint: "The host has not approved this vendor's sponsorship.",
  },
  already_delivered: {
    title: "Already confirmed",
    hint: "Delivery for this vendor was already confirmed.",
  },
  no_vendor_profile: {
    title: "Unknown vendor",
    hint: "No on-chain vendor profile found for this wallet.",
  },
  stale: {
    title: "QR expired",
    hint: "Ask the vendor to wait for the code to refresh and scan again.",
  },
  future: {
    title: "Clock mismatch",
    hint: "The phone's clock looks ahead. Ask them to enable automatic time.",
  },
  bad_signature: {
    title: "Invalid signature",
    hint: "This code does not match the vendor's registered key.",
  },
};
