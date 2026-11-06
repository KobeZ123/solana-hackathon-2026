/**
 * Canonical event metadata hash, shared by the client (create-event page) and the server
 * (POST /api/events). Works in browsers and Node (Web Crypto `crypto.subtle`; browsers
 * require a secure context, which https and localhost satisfy).
 *
 * Definition (binding for every caller):
 *   1. Take exactly four fields: { title, summary, coverUrl, details }.
 *      - `coverUrl` missing/undefined is normalized to `null` (the key is always present).
 *      - `summary` missing/undefined is normalized to "".
 *   2. Serialize to canonical JSON: recursive, object keys sorted by UTF-16 code unit order
 *      (default JS string sort), no whitespace, arrays keep order, values as `JSON.stringify`
 *      would emit them (object properties whose value is `undefined` are omitted).
 *   3. Encode as UTF-8 and compute SHA-256.
 *   4. The on-chain `metadata_hash: [u8; 32]` is those 32 bytes. The API/DB string form is
 *      the same bytes as 64 lowercase hex characters.
 *
 * Example: { title: "A", summary: "", coverUrl: null, details: { b: 1, a: [2] } }
 *   canonical JSON: {"coverUrl":null,"details":{"a":[2],"b":1},"summary":"","title":"A"}
 */
export interface EventMetadata {
  title: string;
  summary?: string;
  coverUrl?: string | null;
  details: unknown;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const s = JSON.stringify(value);
    if (s === undefined) throw new Error("Value is not JSON-serializable");
    return s;
  }
  if (Array.isArray(value)) {
    // JSON.stringify turns undefined array items into null; do the same.
    return `[${value
      .map((v) => (v === undefined ? "null" : canonicalJson(v)))
      .join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(obj).sort()) {
    if (obj[key] === undefined) continue;
    parts.push(`${JSON.stringify(key)}:${canonicalJson(obj[key])}`);
  }
  return `{${parts.join(",")}}`;
}

/** The canonical JSON string of the hashed metadata object. */
export function canonicalMetadataJson(meta: EventMetadata): string {
  return canonicalJson({
    title: meta.title,
    summary: meta.summary ?? "",
    coverUrl: meta.coverUrl ?? null,
    details: meta.details,
  });
}

/** SHA-256 of the canonical metadata JSON as 32 bytes (the on-chain `metadata_hash`). */
export async function metadataHashBytes(
  meta: EventMetadata
): Promise<Uint8Array> {
  const data = new TextEncoder().encode(canonicalMetadataJson(meta));
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}

/** Same hash as 64 lowercase hex characters (the form stored in the API/DB). */
export async function metadataHashHex(meta: EventMetadata): Promise<string> {
  return bytesToHex(await metadataHashBytes(meta));
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
