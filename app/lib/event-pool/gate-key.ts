import nacl from "tweetnacl";
import { createKeyPairSignerFromBytes, type KeyPairSigner } from "@solana/kit";
import { fromBase58, toBase58 } from "../qr/base58";

/** Ephemeral gate keypair: 64-byte ed25519 secret as base58 (seed || public). */
export type GateKey = { publicKey: string; secretKey: string };

export function generateGateKey(): GateKey {
  const kp = nacl.sign.keyPair();
  return {
    publicKey: toBase58(kp.publicKey),
    secretKey: toBase58(kp.secretKey),
  };
}

const storageKey = (event: string) => `event-pool:gate-key:${event}`;

export function saveGateKey(event: string, key: GateKey): boolean {
  try {
    window.localStorage.setItem(storageKey(event), JSON.stringify(key));
    return true;
  } catch {
    return false;
  }
}

/** Stored gate key, or null if absent, corrupt or storage unavailable. */
export function loadGateKey(event: string): GateKey | null {
  try {
    const raw = window.localStorage.getItem(storageKey(event));
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<GateKey> | null;
    if (!p || typeof p.secretKey !== "string") return null;
    const bytes = fromBase58(p.secretKey);
    if (bytes.length !== nacl.sign.secretKeyLength) return null;
    const kp = nacl.sign.keyPair.fromSecretKey(bytes);
    return { publicKey: toBase58(kp.publicKey), secretKey: p.secretKey };
  } catch {
    return null;
  }
}

/** A `TransactionSigner` backed by the gate secret (no wallet popup). */
export function gateSigner(key: GateKey): Promise<KeyPairSigner> {
  return createKeyPairSignerFromBytes(fromBase58(key.secretKey));
}
