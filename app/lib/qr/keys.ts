import nacl from "tweetnacl";
import { fromBase58, toBase58 } from "./base58";

/**
 * Ephemeral ticket keypair. `publicKey` goes on-chain in `Ticket.ticket_key`
 * (a 32-byte address, base58). `secretKey` is the 64-byte ed25519 secret
 * (seed || public), base58, and never leaves the member's browser.
 */
export type TicketKey = {
  publicKey: string;
  secretKey: string;
};

export function generateTicketKey(): TicketKey {
  const kp = nacl.sign.keyPair();
  return {
    publicKey: toBase58(kp.publicKey),
    secretKey: toBase58(kp.secretKey),
  };
}

/** Derive the full key record from a base58 64-byte secret key. */
export function ticketKeyFromSecret(secretKey: string): TicketKey {
  const bytes = fromBase58(secretKey);
  if (bytes.length !== nacl.sign.secretKeyLength) {
    throw new Error("Invalid ticket secret key length");
  }
  const kp = nacl.sign.keyPair.fromSecretKey(bytes);
  return { publicKey: toBase58(kp.publicKey), secretKey };
}

function storageKey(event: string, wallet: string): string {
  return `event-pool:ticket-key:${event}:${wallet}`;
}

/** Persist a ticket key. Returns false when storage is unavailable. */
export function saveTicketKey(
  event: string,
  wallet: string,
  key: TicketKey
): boolean {
  try {
    window.localStorage.setItem(storageKey(event, wallet), JSON.stringify(key));
    return true;
  } catch {
    return false;
  }
}

/** Load a stored ticket key, or null if absent, corrupt or storage unavailable. */
export function loadTicketKey(event: string, wallet: string): TicketKey | null {
  try {
    const raw = window.localStorage.getItem(storageKey(event, wallet));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as TicketKey).publicKey === "string" &&
      typeof (parsed as TicketKey).secretKey === "string"
    ) {
      return {
        publicKey: (parsed as TicketKey).publicKey,
        secretKey: (parsed as TicketKey).secretKey,
      };
    }
    return null;
  } catch {
    return null;
  }
}
