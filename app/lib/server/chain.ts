import { createHash } from "node:crypto";
import {
  address,
  createSolanaRpc,
  getAddressDecoder,
  getAddressEncoder,
  getBase58Decoder,
  getBase64Encoder,
  getProgramDerivedAddress,
  isAddress,
  type Address,
} from "@solana/kit";
import { getTicketDecoder } from "../../generated/event_pool/accounts/ticket";
import { PROGRAM_ID } from "../config";
import { bytesToHex } from "../metadata";

/**
 * Chain access for the API, behind an interface so tests can use a fake. Until the Codama
 * client (T10) lands this decodes the Anchor accounts by hand: 8-byte discriminator
 * (sha256("account:<Name>")[0..8]) followed by Borsh little-endian fields.
 */

export type EventStatus = "open" | "ended" | "cancelled";

export interface OnChainEvent {
  host: string;
  eventId: bigint;
  gateAuthority: string;
  entryFee: bigint; // lamports
  capacity: number;
  ticketsSold: number;
  checkedIn: number;
  startTs: number; // unix seconds
  endTs: number;
  payoutBps: number;
  status: EventStatus;
  attendeePool: bigint;
  hostBudget: bigint;
  hostWithdrawn: boolean;
  metadataHash: string; // 64 lowercase hex chars
  approvedSponsorTotal: bigint;
}

/** A decoded `Ticket` account (the attendance index input). */
export interface TicketRecord {
  eventPda: string;
  member: string;
  checkedIn: boolean;
  /** unix seconds; 0 when not checked in */
  checkedInAt: number;
}

export interface Chain {
  /** Every `Ticket` account of the program (`getProgramAccounts`). */
  listTickets(): Promise<TicketRecord[]>;
  /** Decoded Event account, or null if it does not exist / is not a valid Event. */
  getEvent(eventPda: string): Promise<OnChainEvent | null>;
  /** Batch variant; result array is index-aligned with the input. */
  getEvents(eventPdas: string[]): Promise<(OnChainEvent | null)[]>;
  /** True when the Ticket PDA for (event, member) exists and is a valid Ticket. */
  ticketExists(eventPda: string, member: string): Promise<boolean>;
}

export interface RawAccount {
  owner: string;
  data: Uint8Array;
}

/** Fetches all program-owned accounts whose data starts with `discriminator`. */
export type ProgramAccountSource = (
  programId: string,
  discriminator: Uint8Array
) => Promise<RawAccount[]>;

/** Fetches raw accounts (null for missing), index-aligned with the input addresses. */
export type AccountSource = (
  addresses: string[]
) => Promise<(RawAccount | null)[]>;

export function accountDiscriminator(name: string): Uint8Array {
  return new Uint8Array(
    createHash("sha256").update(`account:${name}`).digest().subarray(0, 8)
  );
}

const EVENT_DISC = accountDiscriminator("Event");
const TICKET_DISC = accountDiscriminator("Ticket");

function hasDiscriminator(data: Uint8Array, disc: Uint8Array): boolean {
  return data.length >= 8 && disc.every((b, i) => data[i] === b);
}

const STATUSES: EventStatus[] = ["open", "ended", "cancelled"];

/**
 * Decode an `Event` account (including the 8-byte discriminator). Returns null when the
 * discriminator does not match, the data is too short, or the status byte is unknown.
 * Layout (after the discriminator, Borsh LE): host 32, event_id u64, gate_authority 32,
 * entry_fee u64, capacity u32, tickets_sold u32, checked_in u32, start_ts i64, end_ts i64,
 * payout_bps u16, status u8, attendee_pool u64, host_budget u64, host_withdrawn bool,
 * metadata_hash 32, approved_sponsor_total u64, bump u8, vault_bump u8.
 */
export function decodeEventAccount(data: Uint8Array): OnChainEvent | null {
  const MIN_LEN =
    8 + 32 + 8 + 32 + 8 + 4 * 3 + 8 * 2 + 2 + 1 + 8 + 8 + 1 + 32 + 8 + 2;
  if (!hasDiscriminator(data, EVENT_DISC) || data.length < MIN_LEN) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let o = 8;
  const pubkey = () => {
    const v = getAddressDecoder().decode(data.subarray(o, o + 32));
    o += 32;
    return v as string;
  };
  const u64 = () => {
    const v = view.getBigUint64(o, true);
    o += 8;
    return v;
  };
  const i64 = () => {
    const v = view.getBigInt64(o, true);
    o += 8;
    return Number(v);
  };
  const u32 = () => {
    const v = view.getUint32(o, true);
    o += 4;
    return v;
  };

  const host = pubkey();
  const eventId = u64();
  const gateAuthority = pubkey();
  const entryFee = u64();
  const capacity = u32();
  const ticketsSold = u32();
  const checkedIn = u32();
  const startTs = i64();
  const endTs = i64();
  const payoutBps = view.getUint16(o, true);
  o += 2;
  const status = STATUSES[data[o++]];
  if (!status) return null;
  const attendeePool = u64();
  const hostBudget = u64();
  const hostWithdrawn = data[o++] !== 0;
  const metadataHash = bytesToHex(data.subarray(o, o + 32));
  o += 32;
  const approvedSponsorTotal = u64();
  return {
    host,
    eventId,
    gateAuthority,
    entryFee,
    capacity,
    ticketsSold,
    checkedIn,
    startTs,
    endTs,
    payoutBps,
    status,
    attendeePool,
    hostBudget,
    hostWithdrawn,
    metadataHash,
    approvedSponsorTotal,
  };
}

/** Chain implementation over any raw account source (RPC in production, fake in tests). */
export class AccountChain implements Chain {
  constructor(
    private readonly source: AccountSource,
    private readonly programId: string = PROGRAM_ID,
    private readonly programAccounts?: ProgramAccountSource
  ) {}

  async listTickets(): Promise<TicketRecord[]> {
    if (!this.programAccounts) {
      throw new Error("Chain has no program account source configured");
    }
    const accounts = await this.programAccounts(this.programId, TICKET_DISC);
    const decoder = getTicketDecoder();
    const out: TicketRecord[] = [];
    for (const acc of accounts) {
      if (
        acc.owner !== this.programId ||
        !hasDiscriminator(acc.data, TICKET_DISC)
      ) {
        continue;
      }
      try {
        const t = decoder.decode(acc.data);
        out.push({
          eventPda: t.event,
          member: t.member,
          checkedIn: t.checkedIn,
          checkedInAt: t.checkedIn ? Number(t.checkedInAt) : 0,
        });
      } catch {
        /* malformed account: skip */
      }
    }
    return out;
  }

  async getEvents(pdas: string[]): Promise<(OnChainEvent | null)[]> {
    if (pdas.length === 0) return [];
    const accounts = await this.source(pdas);
    return accounts.map((acc) =>
      acc && acc.owner === this.programId ? decodeEventAccount(acc.data) : null
    );
  }

  async getEvent(pda: string): Promise<OnChainEvent | null> {
    return (await this.getEvents([pda]))[0];
  }

  async ticketExists(eventPda: string, member: string): Promise<boolean> {
    if (!isAddress(eventPda) || !isAddress(member)) return false;
    const [ticketPda] = await getProgramDerivedAddress({
      programAddress: address(this.programId),
      seeds: [
        new TextEncoder().encode("ticket"),
        getAddressEncoder().encode(eventPda as Address),
        getAddressEncoder().encode(member as Address),
      ],
    });
    const [acc] = await this.source([ticketPda]);
    return (
      !!acc &&
      acc.owner === this.programId &&
      hasDiscriminator(acc.data, TICKET_DISC)
    );
  }
}

/** Raw account source backed by JSON-RPC `getMultipleAccounts` (chunks of 100). */
export function rpcAccountSource(rpcUrl: string): AccountSource {
  const rpc = createSolanaRpc(rpcUrl);
  const b64 = getBase64Encoder();
  return async (addresses) => {
    const out: (RawAccount | null)[] = [];
    for (let i = 0; i < addresses.length; i += 100) {
      const chunk = addresses.slice(i, i + 100).map((a) => address(a));
      const { value } = await rpc
        .getMultipleAccounts(chunk, { encoding: "base64" })
        .send();
      for (const acc of value) {
        out.push(
          acc
            ? {
                owner: acc.owner as string,
                data: new Uint8Array(b64.encode(acc.data[0])),
              }
            : null
        );
      }
    }
    return out;
  };
}

/** Program account source backed by JSON-RPC `getProgramAccounts` with a memcmp filter. */
export function rpcProgramAccountSource(rpcUrl: string): ProgramAccountSource {
  const rpc = createSolanaRpc(rpcUrl);
  const b64 = getBase64Encoder();
  const b58 = getBase58Decoder();
  return async (programId, discriminator) => {
    const res = await rpc
      .getProgramAccounts(address(programId), {
        encoding: "base64",
        filters: [
          {
            memcmp: {
              offset: 0n,
              bytes: b58.decode(discriminator) as never,
              encoding: "base58",
            },
          },
        ],
      })
      .send();
    return res.map((entry) => ({
      owner: entry.account.owner as string,
      data: new Uint8Array(b64.encode(entry.account.data[0])),
    }));
  };
}

export function createChainFromEnv(
  env: NodeJS.ProcessEnv = process.env
): Chain {
  const rpcUrl = env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
  return new AccountChain(
    rpcAccountSource(rpcUrl),
    env.NEXT_PUBLIC_PROGRAM_ID || PROGRAM_ID,
    rpcProgramAccountSource(rpcUrl)
  );
}

declare global {
  var __eventPoolChain: Chain | undefined;
}

export function getChain(): Chain {
  return (globalThis.__eventPoolChain ??= createChainFromEnv());
}

/** Tests: install a fake chain for the process. */
export function setChain(chain: Chain | undefined): void {
  globalThis.__eventPoolChain = chain;
}
