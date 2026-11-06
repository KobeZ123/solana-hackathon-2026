import { getAddressEncoder, type Address } from "@solana/kit";
import { accountDiscriminator, type Chain, type OnChainEvent } from "./chain";

/** Test-only helpers for chain access. */

export class FakeChain implements Chain {
  events = new Map<string, OnChainEvent>();
  tickets = new Set<string>(); // `${event}:${member}`
  failRpc = false;

  private check() {
    if (this.failRpc) throw new Error("rpc down");
  }
  async getEvent(pda: string) {
    this.check();
    return this.events.get(pda) ?? null;
  }
  async getEvents(pdas: string[]) {
    this.check();
    return pdas.map((p) => this.events.get(p) ?? null);
  }
  async ticketExists(event: string, member: string) {
    this.check();
    return this.tickets.has(`${event}:${member}`);
  }
}

export function sampleOnChainEvent(
  over: Partial<OnChainEvent> & { host: string }
): OnChainEvent {
  return {
    eventId: 1n,
    gateAuthority: over.host,
    entryFee: 50_000_000n,
    capacity: 100,
    ticketsSold: 3,
    checkedIn: 1,
    startTs: 1_800_000_000,
    endTs: 1_800_003_600,
    payoutBps: 3000,
    status: "open",
    attendeePool: 0n,
    hostBudget: 0n,
    hostWithdrawn: false,
    metadataHash: "00".repeat(32),
    approvedSponsorTotal: 0n,
    ...over,
  };
}

/** Serialize an Event account exactly as Anchor/Borsh would (discriminator included). */
export function encodeEventAccount(e: OnChainEvent): Uint8Array {
  const out = new Uint8Array(
    8 + 32 + 8 + 32 + 8 + 12 + 16 + 2 + 1 + 16 + 1 + 32 + 8 + 2
  );
  const view = new DataView(out.buffer);
  const addr = getAddressEncoder();
  let o = 0;
  out.set(accountDiscriminator("Event"), o);
  o += 8;
  out.set(addr.encode(e.host as Address), o);
  o += 32;
  view.setBigUint64(o, e.eventId, true);
  o += 8;
  out.set(addr.encode(e.gateAuthority as Address), o);
  o += 32;
  view.setBigUint64(o, e.entryFee, true);
  o += 8;
  view.setUint32(o, e.capacity, true);
  view.setUint32(o + 4, e.ticketsSold, true);
  view.setUint32(o + 8, e.checkedIn, true);
  o += 12;
  view.setBigInt64(o, BigInt(e.startTs), true);
  view.setBigInt64(o + 8, BigInt(e.endTs), true);
  o += 16;
  view.setUint16(o, e.payoutBps, true);
  o += 2;
  out[o++] = ["open", "ended", "cancelled"].indexOf(e.status);
  view.setBigUint64(o, e.attendeePool, true);
  view.setBigUint64(o + 8, e.hostBudget, true);
  o += 16;
  out[o++] = e.hostWithdrawn ? 1 : 0;
  for (let i = 0; i < 32; i++) {
    out[o + i] = parseInt(e.metadataHash.slice(i * 2, i * 2 + 2), 16);
  }
  o += 32;
  view.setBigUint64(o, e.approvedSponsorTotal, true);
  o += 8;
  out[o++] = 255; // bump
  out[o++] = 254; // vault_bump
  return out;
}
