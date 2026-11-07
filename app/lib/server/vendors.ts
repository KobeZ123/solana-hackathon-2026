import { isAddress } from "@solana/kit";
import { OFFER_TEXT_MAX, offerHashHex } from "../offer";
import type { AuthContext } from "./auth";
import {
  getChain,
  type Chain,
  type OnChainSponsorship,
  type OnChainVendorProfile,
} from "./chain";
import { ApiError } from "./errors";
import { getStore, type Store, type StoredVendor } from "./store";

/** Stretch A: vendor profiles and sponsorship offers (off-chain half of the vendor flow). */

export interface VendorDeps {
  store?: Store;
  chain?: Chain;
  now?: () => number; // unix ms
}

export interface VendorView {
  wallet: string;
  name: string;
  logoUrl: string | null;
  description: string;
  /** On-chain `VendorProfile.vendor_key`; null when the chain could not be read. */
  vendorKey: string | null;
  updatedAt: string;
}

export interface OfferView {
  eventPda: string;
  vendor: string;
  /** Lamports, decimal string. */
  amount: string;
  status: OnChainSponsorship["status"];
  offerHash: string;
  /** Off-chain offer text; null until the vendor has posted it. */
  offerText: string | null;
  /** True when sha256(canonical offer) of `offerText` equals the on-chain hash. */
  offerVerified: boolean;
  vendorProfile: {
    name: string;
    logoUrl: string | null;
    description: string;
  } | null;
}

function assertAddress(v: string, what: string): void {
  if (!isAddress(v)) throw new ApiError(400, `Invalid ${what} address`);
}

function parseLogoUrl(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || v.length > 2000) {
    throw new ApiError(400, 'Field "logoUrl" must be a string URL');
  }
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    throw new ApiError(400, 'Field "logoUrl" must be a valid URL');
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new ApiError(400, 'Field "logoUrl" must be an http(s) URL');
  }
  return v;
}

async function chainVendor(
  chain: Chain,
  wallet: string
): Promise<OnChainVendorProfile | null> {
  try {
    return await chain.getVendorProfile(wallet);
  } catch (err) {
    console.error("RPC error reading vendor profile", err);
    throw new ApiError(502, "Could not read the VendorProfile from the chain");
  }
}

function toVendorView(v: StoredVendor, vendorKey: string | null): VendorView {
  return {
    wallet: v.wallet,
    name: v.name,
    logoUrl: v.logoUrl,
    description: v.description,
    vendorKey,
    updatedAt: v.updatedAt,
  };
}

/** POST /api/vendors: upsert the caller's profile; the on-chain VendorProfile must exist. */
export async function upsertVendorProfile(
  auth: AuthContext,
  body: Record<string, unknown>,
  deps: VendorDeps = {}
): Promise<VendorView> {
  const store = deps.store ?? getStore();
  const chain = deps.chain ?? getChain();

  const name = body.name;
  if (typeof name !== "string" || name.trim() === "" || name.length > 100) {
    throw new ApiError(
      400,
      'Field "name" must be a non-empty string (max 100)'
    );
  }
  const description = body.description ?? "";
  if (typeof description !== "string" || description.length > 2000) {
    throw new ApiError(400, 'Field "description" must be a string (max 2000)');
  }
  const logoUrl = parseLogoUrl(body.logoUrl);

  const profile = await chainVendor(chain, auth.wallet);
  if (!profile) {
    throw new ApiError(
      400,
      "No on-chain VendorProfile for this wallet; call register_vendor first"
    );
  }
  const stored: StoredVendor = {
    wallet: auth.wallet,
    name: name.trim(),
    logoUrl,
    description,
    updatedAt: new Date((deps.now ?? Date.now)()).toISOString(),
  };
  await store.upsertVendor(stored);
  return toVendorView(stored, profile.vendorKey);
}

/** GET /api/vendors/[wallet]: public profile merged with the on-chain vendor key. */
export async function getVendorView(
  wallet: string,
  deps: VendorDeps = {}
): Promise<VendorView> {
  assertAddress(wallet, "wallet");
  const store = deps.store ?? getStore();
  const chain = deps.chain ?? getChain();
  const stored = await store.getVendor(wallet);
  if (!stored) throw new ApiError(404, "Vendor not found");
  let vendorKey: string | null = null;
  try {
    vendorKey = (await chain.getVendorProfile(wallet))?.vendorKey ?? null;
  } catch (err) {
    console.error("RPC error reading vendor profile", err);
  }
  return toVendorView(stored, vendorKey);
}

async function sponsorshipsOf(
  chain: Chain,
  eventPda: string
): Promise<OnChainSponsorship[]> {
  try {
    return await chain.listSponsorships(eventPda);
  } catch (err) {
    console.error("RPC error listing sponsorships", err);
    throw new ApiError(502, "Could not read sponsorships from the chain");
  }
}

/**
 * POST /api/events/[pda]/offers: the vendor posts the offer text for its on-chain
 * Sponsorship. The text must hash to `Sponsorship.offer_hash` (so propose first).
 */
export async function putOffer(
  eventPda: string,
  auth: AuthContext,
  body: Record<string, unknown>,
  deps: VendorDeps = {}
): Promise<OfferView> {
  assertAddress(eventPda, "event");
  const store = deps.store ?? getStore();
  const chain = deps.chain ?? getChain();

  const text = body.text;
  if (typeof text !== "string" || text.trim() === "") {
    throw new ApiError(400, 'Field "text" must be a non-empty string');
  }
  if (text.length > OFFER_TEXT_MAX) {
    throw new ApiError(400, `Field "text" is too long (max ${OFFER_TEXT_MAX})`);
  }
  const sponsorship = (await sponsorshipsOf(chain, eventPda)).find(
    (s) => s.vendor === auth.wallet
  );
  if (!sponsorship) {
    throw new ApiError(
      404,
      "No on-chain sponsorship for this vendor; call propose_sponsorship first"
    );
  }
  const hash = await offerHashHex(text);
  if (hash !== sponsorship.offerHash) {
    throw new ApiError(400, "Offer does not match the on-chain offer_hash");
  }
  await store.upsertOffer({
    eventPda,
    vendorWallet: auth.wallet,
    text,
    offerHash: hash,
    updatedAt: new Date((deps.now ?? Date.now)()).toISOString(),
  });
  return {
    eventPda,
    vendor: auth.wallet,
    amount: sponsorship.amount.toString(),
    status: sponsorship.status,
    offerHash: hash,
    offerText: text,
    offerVerified: true,
    vendorProfile: await profileOf(store, auth.wallet),
  };
}

async function profileOf(
  store: Store,
  wallet: string
): Promise<OfferView["vendorProfile"]> {
  const v = await store.getVendor(wallet);
  return v
    ? { name: v.name, logoUrl: v.logoUrl, description: v.description }
    : null;
}

/**
 * GET /api/events/[pda]/offers: the host sees every sponsorship of the event, a vendor
 * only its own; anyone else gets 403. Off-chain text is merged with on-chain status/amount.
 */
export async function listOffers(
  eventPda: string,
  auth: AuthContext,
  deps: VendorDeps = {}
): Promise<OfferView[]> {
  assertAddress(eventPda, "event");
  const store = deps.store ?? getStore();
  const chain = deps.chain ?? getChain();

  let event;
  try {
    event = await chain.getEvent(eventPda);
  } catch (err) {
    console.error("RPC error reading event", err);
    throw new ApiError(502, "Could not read the Event account from the chain");
  }
  if (!event) throw new ApiError(404, "Event not found");
  const isHost = event.host === auth.wallet;

  let sponsorships = await sponsorshipsOf(chain, eventPda);
  if (!isHost) {
    sponsorships = sponsorships.filter((s) => s.vendor === auth.wallet);
    if (sponsorships.length === 0) {
      throw new ApiError(403, "Only the host or the offering vendor can view");
    }
  }
  const offers = new Map(
    (await store.listOffers(eventPda)).map((o) => [o.vendorWallet, o])
  );
  const out: OfferView[] = [];
  for (const s of sponsorships) {
    const offer = offers.get(s.vendor) ?? null;
    out.push({
      eventPda,
      vendor: s.vendor,
      amount: s.amount.toString(),
      status: s.status,
      offerHash: s.offerHash,
      offerText: offer?.text ?? null,
      offerVerified: offer ? offer.offerHash === s.offerHash : false,
      vendorProfile: await profileOf(store, s.vendor),
    });
  }
  return out;
}
