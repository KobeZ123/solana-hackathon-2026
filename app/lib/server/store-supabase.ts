import type { AttendanceRow, NonceRecord, Store, StoredEvent } from "./store";

type Row = Record<string, unknown>;

/**
 * Supabase store talking to PostgREST directly with the service-role key (server only;
 * tables have RLS enabled and no public policies). Plain `fetch` keeps the dependency
 * surface small and the class testable with an injected fetch.
 */
export class SupabaseStore implements Store {
  private readonly base: string;

  constructor(
    url: string,
    private readonly serviceKey: string,
    private readonly fetchImpl: typeof fetch = (...a) => fetch(...a)
  ) {
    this.base = `${url.replace(/\/+$/, "")}/rest/v1`;
  }

  private async rest(
    table: string,
    query: string,
    init: { method?: string; body?: unknown; prefer?: string } = {}
  ): Promise<{ status: number; rows: Row[] }> {
    const res = await this.fetchImpl(`${this.base}/${table}${query}`, {
      method: init.method ?? "GET",
      headers: {
        apikey: this.serviceKey,
        Authorization: `Bearer ${this.serviceKey}`,
        "Content-Type": "application/json",
        ...(init.prefer ? { Prefer: init.prefer } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok && res.status !== 409) {
      throw new Error(`Supabase ${table} ${res.status}: ${text}`);
    }
    return {
      status: res.status,
      rows: res.ok && text ? (JSON.parse(text) as Row[]) : [],
    };
  }

  async putNonce(r: NonceRecord): Promise<void> {
    await this.rest("auth_nonces", "?on_conflict=wallet", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: {
        wallet: r.wallet,
        nonce: r.nonce,
        expires_at: new Date(r.expiresAt).toISOString(),
      },
    });
  }

  async consumeNonce(wallet: string, now: number): Promise<NonceRecord | null> {
    // DELETE ... RETURNING is atomic, so a nonce can be consumed exactly once.
    const { rows } = await this.rest(
      "auth_nonces",
      `?wallet=eq.${encodeURIComponent(wallet)}`,
      { method: "DELETE", prefer: "return=representation" }
    );
    const row = rows[0];
    if (!row) return null;
    const expiresAt = Date.parse(row.expires_at as string);
    if (!(expiresAt > now)) return null;
    return { wallet, nonce: row.nonce as string, expiresAt };
  }

  async insertEvent(e: StoredEvent): Promise<boolean> {
    const { status } = await this.rest("events", "", {
      method: "POST",
      prefer: "return=minimal",
      body: {
        event_pda: e.eventPda,
        host_wallet: e.hostWallet,
        title: e.title,
        summary: e.summary,
        cover_url: e.coverUrl,
        details: e.details,
        metadata_hash: e.metadataHash,
        visibility: e.visibility,
        created_at: e.createdAt,
      },
    });
    return status !== 409;
  }

  async getEvent(eventPda: string): Promise<StoredEvent | null> {
    const { rows } = await this.rest(
      "events",
      `?event_pda=eq.${encodeURIComponent(eventPda)}&limit=1`
    );
    return rows[0] ? toEvent(rows[0]) : null;
  }

  async listEvents(): Promise<StoredEvent[]> {
    const { rows } = await this.rest("events", "?order=created_at.desc");
    return rows.map(toEvent);
  }

  async upsertAttendance(rows: AttendanceRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.rest("attendance", "?on_conflict=event_pda,wallet", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: rows.map((r) => ({
        event_pda: r.eventPda,
        wallet: r.wallet,
        checked_in: r.checkedIn,
        checked_in_at: r.checkedInAt,
      })),
    });
  }

  async listAttendance(): Promise<AttendanceRow[]> {
    const { rows } = await this.rest("attendance", "");
    return rows.map((r) => ({
      eventPda: r.event_pda as string,
      wallet: r.wallet as string,
      checkedIn: r.checked_in as boolean,
      checkedInAt: (r.checked_in_at as string | null) ?? null,
    }));
  }
}

function toEvent(r: Row): StoredEvent {
  return {
    eventPda: r.event_pda as string,
    hostWallet: r.host_wallet as string,
    title: r.title as string,
    summary: (r.summary as string | null) ?? "",
    coverUrl: (r.cover_url as string | null) ?? null,
    details: r.details,
    metadataHash: r.metadata_hash as string,
    visibility: ((r.visibility as string) ??
      "public") as StoredEvent["visibility"],
    createdAt: r.created_at as string,
  };
}
