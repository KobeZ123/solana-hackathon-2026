import { getAddressDecoder, getBase58Decoder } from "@solana/kit";
import { FileStore } from "./store-file";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** Test-only helpers (not imported by app code). */

export interface TestWallet {
  address: string;
  /** base58 ed25519 signature of the UTF-8 message */
  sign(message: string): Promise<string>;
}

export async function makeWallet(): Promise<TestWallet> {
  const pair = (await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const raw = new Uint8Array(
    await crypto.subtle.exportKey("raw", pair.publicKey)
  );
  return {
    address: getAddressDecoder().decode(raw),
    async sign(message) {
      const sig = await crypto.subtle.sign(
        "Ed25519",
        pair.privateKey,
        new TextEncoder().encode(message)
      );
      return getBase58Decoder().decode(new Uint8Array(sig));
    },
  };
}

export function tempFileStore(): FileStore {
  const dir = mkdtempSync(path.join(tmpdir(), "event-pool-store-"));
  return new FileStore(path.join(dir, "store.json"));
}
