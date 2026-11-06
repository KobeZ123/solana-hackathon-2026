import { getBase58Codec } from "@solana/kit";

const codec = getBase58Codec();

/** Encode raw bytes as a base58 string (Solana address/signature format). */
export function toBase58(bytes: Uint8Array): string {
  return codec.decode(bytes);
}

/** Decode a base58 string to bytes. Throws on invalid characters. */
export function fromBase58(value: string): Uint8Array {
  return new Uint8Array(codec.encode(value));
}
