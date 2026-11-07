import { FileStore } from "./store-file";
import { SupabaseStore } from "./store-supabase";

export type Visibility = "public" | "network";

export interface StoredEvent {
  eventPda: string;
  hostWallet: string;
  title: string;
  summary: string;
  coverUrl: string | null;
  /** Gated payload (location, description, links...). Arbitrary JSON. */
  details: unknown;
  metadataHash: string;
  visibility: Visibility;
  createdAt: string; // ISO
}

export interface NonceRecord {
  wallet: string;
  nonce: string;
  expiresAt: number; // unix ms
}

export interface AttendanceRow {
  eventPda: string;
  wallet: string;
  checkedIn: boolean;
  checkedInAt: string | null;
}

/** Stretch A: off-chain vendor profile (the on-chain VendorProfile holds only the key). */
export interface StoredVendor {
  wallet: string;
  name: string;
  logoUrl: string | null;
  description: string;
  updatedAt: string; // ISO
}

/** Stretch A: off-chain offer text for a sponsorship, keyed by (eventPda, vendorWallet). */
export interface StoredOffer {
  eventPda: string;
  vendorWallet: string;
  text: string;
  /** sha256 hex of the canonical offer JSON; equals Sponsorship.offer_hash. */
  offerHash: string;
  updatedAt: string; // ISO
}

/**
 * Persistence boundary for the API. Implementations: Supabase (PostgREST, service role)
 * and a JSON file (local dev). Behaviour is pinned by `store.contract.test.ts`.
 */
export interface Store {
  /** Store the (single) outstanding nonce for a wallet, replacing any previous one. */
  putNonce(record: NonceRecord): Promise<void>;
  /**
   * Atomically remove and return the wallet's nonce. Returns null when none exists or
   * it has expired (`expiresAt <= now`); an expired nonce is still removed.
   */
  consumeNonce(wallet: string, now: number): Promise<NonceRecord | null>;

  /** Insert a new event. Returns false (and stores nothing) if `eventPda` already exists. */
  insertEvent(event: StoredEvent): Promise<boolean>;
  getEvent(eventPda: string): Promise<StoredEvent | null>;
  /** Newest first. */
  listEvents(): Promise<StoredEvent[]>;

  /** Stretch B: insert or replace attendance rows keyed by (eventPda, wallet). */
  upsertAttendance(rows: AttendanceRow[]): Promise<void>;
  listAttendance(): Promise<AttendanceRow[]>;

  /** Stretch A: insert or replace the vendor profile for a wallet. */
  upsertVendor(vendor: StoredVendor): Promise<void>;
  getVendor(wallet: string): Promise<StoredVendor | null>;
  /** Stretch A: insert or replace the offer keyed by (eventPda, vendorWallet). */
  upsertOffer(offer: StoredOffer): Promise<void>;
  getOffer(eventPda: string, vendorWallet: string): Promise<StoredOffer | null>;
  listOffers(eventPda: string): Promise<StoredOffer[]>;
}

declare global {
  var __eventPoolStore: Store | undefined;
}

export function createStoreFromEnv(
  env: NodeJS.ProcessEnv = process.env
): Store {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) return new SupabaseStore(url, key);
  return new FileStore(env.STORE_FILE ?? ".data/store.json");
}

/** Process-wide store (cached on globalThis so Next dev HMR does not recreate it). */
export function getStore(): Store {
  return (globalThis.__eventPoolStore ??= createStoreFromEnv());
}

/** Tests: install a store for the process. */
export function setStore(store: Store | undefined): void {
  globalThis.__eventPoolStore = store;
}
