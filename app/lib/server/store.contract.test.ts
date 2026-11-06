import { describe, expect, it } from "vitest";
import { SupabaseStore } from "./store-supabase";
import type { Store, StoredEvent } from "./store";
import { tempFileStore } from "./testing";

const ev = (pda: string, createdAt: string): StoredEvent => ({
  eventPda: pda,
  hostWallet: "host1",
  title: "T",
  summary: "S",
  coverUrl: null,
  details: { location: "here" },
  metadataHash: "ab".repeat(32),
  visibility: "public",
  createdAt,
});

/** Contract every Store implementation must satisfy. */
export function runStoreContract(name: string, make: () => Store) {
  describe(`Store contract: ${name}`, () => {
    it("nonce: single use", async () => {
      const s = make();
      await s.putNonce({ wallet: "w", nonce: "n1", expiresAt: 2000 });
      expect((await s.consumeNonce("w", 1000))?.nonce).toBe("n1");
      expect(await s.consumeNonce("w", 1000)).toBeNull();
    });

    it("nonce: expired is rejected and removed", async () => {
      const s = make();
      await s.putNonce({ wallet: "w", nonce: "n1", expiresAt: 2000 });
      expect(await s.consumeNonce("w", 2000)).toBeNull();
      expect(await s.consumeNonce("w", 1000)).toBeNull();
    });

    it("nonce: new nonce replaces the old one; unknown wallet is null", async () => {
      const s = make();
      await s.putNonce({ wallet: "w", nonce: "old", expiresAt: 5000 });
      await s.putNonce({ wallet: "w", nonce: "new", expiresAt: 5000 });
      expect((await s.consumeNonce("w", 1))?.nonce).toBe("new");
      expect(await s.consumeNonce("other", 1)).toBeNull();
    });

    it("events: insert, get, duplicate rejected, list newest first", async () => {
      const s = make();
      expect(await s.getEvent("a")).toBeNull();
      expect(await s.insertEvent(ev("a", "2026-01-01T00:00:00.000Z"))).toBe(
        true
      );
      expect(await s.insertEvent(ev("a", "2026-01-05T00:00:00.000Z"))).toBe(
        false
      );
      expect(await s.insertEvent(ev("b", "2026-01-02T00:00:00.000Z"))).toBe(
        true
      );
      expect((await s.getEvent("a"))?.createdAt).toBe(
        "2026-01-01T00:00:00.000Z"
      );
      expect((await s.listEvents()).map((e) => e.eventPda)).toEqual(["b", "a"]);
    });

    it("attendance: upsert replaces by (event, wallet)", async () => {
      const s = make();
      await s.upsertAttendance([
        { eventPda: "e", wallet: "w", checkedIn: false, checkedInAt: null },
      ]);
      await s.upsertAttendance([
        { eventPda: "e", wallet: "w", checkedIn: true, checkedInAt: "t" },
        { eventPda: "e", wallet: "x", checkedIn: false, checkedInAt: null },
      ]);
      const rows = await s.listAttendance();
      expect(rows).toHaveLength(2);
      expect(rows.find((r) => r.wallet === "w")?.checkedIn).toBe(true);
    });

    it("concurrent consumes yield exactly one winner", async () => {
      const s = make();
      await s.putNonce({ wallet: "w", nonce: "n", expiresAt: 5000 });
      const results = await Promise.all(
        Array.from({ length: 5 }, () => s.consumeNonce("w", 1))
      );
      expect(results.filter(Boolean)).toHaveLength(1);
    });
  });
}

runStoreContract("FileStore", tempFileStore);

/** Minimal in-memory PostgREST fake, enough to run the same contract over SupabaseStore. */
function fakePostgrest(): typeof fetch {
  const tables: Record<string, Record<string, unknown>[]> = {
    auth_nonces: [],
    events: [],
    attendance: [],
  };
  const keyOf: Record<string, string[]> = {
    auth_nonces: ["wallet"],
    events: ["event_pda"],
    attendance: ["event_pda", "wallet"],
  };
  const json = (status: number, body?: unknown) =>
    new Response(body === undefined ? "" : JSON.stringify(body), { status });

  return (async (url: string, init: RequestInit) => {
    const u = new URL(url);
    const table = u.pathname.split("/").pop()!;
    const rows = tables[table];
    const keys = keyOf[table];
    const method = init.method ?? "GET";
    const same = (a: Record<string, unknown>, b: Record<string, unknown>) =>
      keys.every((k) => a[k] === b[k]);
    if (method === "POST") {
      const body = JSON.parse(init.body as string);
      const items = Array.isArray(body) ? body : [body];
      const merge = String(
        (init.headers as Record<string, string>).Prefer
      ).includes("merge-duplicates");
      for (const item of items) {
        const i = rows.findIndex((r) => same(r, item));
        if (i >= 0) {
          if (!merge) return json(409, { code: "23505" });
          rows[i] = item;
        } else rows.push(item);
      }
      return json(201);
    }
    if (method === "DELETE") {
      const wallet = u.searchParams.get("wallet")!.replace(/^eq\./, "");
      const hit = rows.filter((r) => r.wallet === wallet);
      tables[table] = rows.filter((r) => r.wallet !== wallet);
      return json(200, hit);
    }
    let out = [...rows];
    const pda = u.searchParams.get("event_pda");
    if (pda) out = out.filter((r) => r.event_pda === pda.replace(/^eq\./, ""));
    if (u.searchParams.get("order") === "created_at.desc") {
      out.sort((a, b) =>
        String(b.created_at).localeCompare(String(a.created_at))
      );
    }
    return json(200, out);
  }) as unknown as typeof fetch;
}

runStoreContract(
  "SupabaseStore (fake PostgREST)",
  () => new SupabaseStore("https://x.supabase.co", "svc", fakePostgrest())
);
