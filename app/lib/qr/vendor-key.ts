import { generateTicketKey, type TicketKey } from "./keys";

/** Vendor QR signing key: same shape as a ticket key; one per vendor wallet. */
export type VendorKey = TicketKey;

export const generateVendorKey = (): VendorKey => generateTicketKey();

const storageKey = (wallet: string) => `event-pool:vendor-key:${wallet}`;

export function saveVendorKey(wallet: string, key: VendorKey): boolean {
  try {
    window.localStorage.setItem(storageKey(wallet), JSON.stringify(key));
    return true;
  } catch {
    return false;
  }
}

/** Stored vendor key, or null if absent, corrupt or storage unavailable. */
export function loadVendorKey(wallet: string): VendorKey | null {
  try {
    const raw = window.localStorage.getItem(storageKey(wallet));
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<VendorKey> | null;
    if (
      !p ||
      typeof p.publicKey !== "string" ||
      typeof p.secretKey !== "string"
    ) {
      return null;
    }
    return { publicKey: p.publicKey, secretKey: p.secretKey };
  } catch {
    return null;
  }
}
