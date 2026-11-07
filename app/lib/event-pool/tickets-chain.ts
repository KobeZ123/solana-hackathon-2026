import {
  getBase64Encoder,
  type Address,
  type Base58EncodedBytes,
  type Rpc,
  type GetProgramAccountsApi,
} from "@solana/kit";
import {
  TICKET_DISCRIMINATOR,
  getTicketDecoder,
  type Ticket,
} from "../../generated/event_pool";
import { PROGRAM_ID } from "../config";
import { toBase58 } from "../qr/base58";

/**
 * Ticket account layout (see docs/TICKETS.md): 8-byte Anchor discriminator,
 * then `event` at offset 8, `member` at offset 40, `ticket_key` at offset 72.
 */
export const TICKET_EVENT_OFFSET = 8n;
export const TICKET_MEMBER_OFFSET = 40n;

export type MemcmpFilter = {
  memcmp: {
    offset: bigint;
    bytes: Base58EncodedBytes;
    encoding: "base58";
  };
};

export function memcmp(offset: bigint, base58: string): MemcmpFilter {
  return {
    memcmp: {
      offset,
      bytes: base58 as Base58EncodedBytes,
      encoding: "base58",
    },
  };
}

const TICKET_DISCRIMINATOR_FILTER = memcmp(0n, toBase58(TICKET_DISCRIMINATOR));

/** Filters selecting every Ticket of one event. */
export function ticketsByEventFilters(event: Address): MemcmpFilter[] {
  return [TICKET_DISCRIMINATOR_FILTER, memcmp(TICKET_EVENT_OFFSET, event)];
}

/** Filters selecting every Ticket held by one wallet. */
export function ticketsByMemberFilters(member: Address): MemcmpFilter[] {
  return [TICKET_DISCRIMINATOR_FILTER, memcmp(TICKET_MEMBER_OFFSET, member)];
}

export type TicketRecord = { address: Address; data: Ticket };

type TicketsRpc = Rpc<GetProgramAccountsApi>;

async function fetchTickets(
  rpc: TicketsRpc,
  filters: MemcmpFilter[]
): Promise<TicketRecord[]> {
  const accounts = await rpc
    .getProgramAccounts(PROGRAM_ID, { encoding: "base64", filters })
    .send();
  const decoder = getTicketDecoder();
  const b64 = getBase64Encoder();
  const out: TicketRecord[] = [];
  for (const acc of accounts) {
    try {
      out.push({
        address: acc.pubkey,
        data: decoder.decode(b64.encode(acc.account.data[0])),
      });
    } catch {
      // Not a decodable Ticket (should not happen with the filters): skip.
    }
  }
  return out;
}

export function fetchEventTickets(rpc: TicketsRpc, event: Address) {
  return fetchTickets(rpc, ticketsByEventFilters(event));
}

export function fetchMemberTickets(rpc: TicketsRpc, member: Address) {
  return fetchTickets(rpc, ticketsByMemberFilters(member));
}
