import { bytesToHex, canonicalJson } from "./metadata";

/**
 * Sponsorship offer hash (stretch A), shared by the vendor UI and the server.
 * `Sponsorship.offer_hash` = SHA-256 of the canonical JSON (see metadata.ts) of
 * `{ text }`, i.e. `{"text":"<offer text>"}` with the text exactly as stored.
 */
export const OFFER_TEXT_MAX = 2000;

export function canonicalOfferJson(text: string): string {
  return canonicalJson({ text });
}

export async function offerHashBytes(text: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(canonicalOfferJson(text));
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}

/** Same hash as 64 lowercase hex characters (the form stored in the API/DB). */
export async function offerHashHex(text: string): Promise<string> {
  return bytesToHex(await offerHashBytes(text));
}
