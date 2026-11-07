import type {
  AttendanceRow,
  NonceRecord,
  Store,
  StoredEvent,
  StoredOffer,
  StoredVendor,
} from "./store";

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

  async upsertVendor(v: StoredVendor): Promise<void> {
    await this.rest("vendors", "?on_conflict=wallet", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: {
        wallet: v.wallet,
        name: v.name,
        logo_url: v.logoUrl,
        description: v.description,
        updated_at: v.updatedAt,
      },
    });
  }

  async getVendor(wallet: string): Promise<StoredVendor | null> {
    const { rows } = await this.rest(
      "vendors",
      `?wallet=eq.${encodeURIComponent(wallet)}&limit=1`
    );
    const r = rows[0];
    return r
      ? {
          wallet: r.wallet as string,
          name: r.name as string,
          logoUrl: (r.logo_url as string | null) ?? null,
          description: (r.description as string | null) ?? "",
          updatedAt: r.updated_at as string,
        }
      : null;
  }

  async upsertOffer(o: StoredOffer): Promise<void> {
    await this.rest(
      "sponsorship_offers",
      "?on_conflict=event_pda,vendor_wallet",
      {
        method: "POST",
        prefer: "resolution=merge-duplicates,return=minimal",
        body: {
          event_pda: o.eventPda,
          vendor_wallet: o.vendorWallet,
          text: o.text,
          offer_hash: o.offerHash,
          updated_at: o.updatedAt,
        },
      }
    );
  }

  async getOffer(
    eventPda: string,
    vendorWallet: string
  ): Promise<StoredOffer | null> {
    const { rows } = await this.rest(
      "sponsorship_offers",
      `?event_pda=eq.${encodeURIComponent(eventPda)}&vendor_wallet=eq.${encodeURIComponent(vendorWallet)}&limit=1`
    );
    return rows[0] ? toOffer(rows[0]) : null;
  }

  async listOffers(eventPda: string): Promise<StoredOffer[]> {
    const { rows } = await this.rest(
      "sponsorship_offers",
      `?event_pda=eq.${encodeURIComponent(eventPda)}`
    );
    return rows.map(toOffer);
  }
}

function toOffer(r: Row): StoredOffer {
  return {
    eventPda: r.event_pda as string,
    vendorWallet: r.vendor_wallet as string,
    text: r.text as string,
    offerHash: r.offer_hash as string,
    updatedAt: r.updated_at as string,
  };
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
