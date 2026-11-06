import { describe, expect, it } from "vitest";
import {
  getAddressEncoder,
  getProgramDerivedAddress,
  address,
} from "@solana/kit";
import { createHash } from "node:crypto";
import { PROGRAM_ID } from "../config";
import {
  AccountChain,
  accountDiscriminator,
  decodeEventAccount,
  type AccountSource,
  type RawAccount,
} from "./chain";
import { encodeEventAccount, sampleOnChainEvent } from "./chain-testing";
import { makeWallet } from "./testing";

describe("account discriminators", () => {
  it("is the first 8 bytes of sha256('account:Name')", () => {
    const expected = createHash("sha256").update("account:Event").digest();
    expect(Buffer.from(accountDiscriminator("Event")).toString("hex")).toBe(
      expected.subarray(0, 8).toString("hex")
    );
  });
});

describe("decodeEventAccount", () => {
  it("round-trips every field", async () => {
    const host = (await makeWallet()).address;
    const gate = (await makeWallet()).address;
    const e = sampleOnChainEvent({
      host,
      gateAuthority: gate,
      eventId: 1_700_000_000_123n,
      entryFee: 2_500_000_000n,
      capacity: 77,
      ticketsSold: 5,
      checkedIn: 2,
      startTs: 1_800_000_000,
      endTs: 1_800_007_200,
      payoutBps: 4500,
      status: "ended",
      attendeePool: 123n,
      hostBudget: 456n,
      hostWithdrawn: true,
      metadataHash: "ab".repeat(32),
      approvedSponsorTotal: 9n,
    });
    expect(decodeEventAccount(encodeEventAccount(e))).toEqual(e);
  });

  it("rejects wrong discriminator, truncated data and unknown status", async () => {
    const host = (await makeWallet()).address;
    const good = encodeEventAccount(sampleOnChainEvent({ host }));
    const wrongDisc = good.slice();
    wrongDisc[0] ^= 0xff;
    expect(decodeEventAccount(wrongDisc)).toBeNull();
    expect(decodeEventAccount(good.subarray(0, 100))).toBeNull();
    const badStatus = good.slice();
    badStatus[8 + 32 + 8 + 32 + 8 + 12 + 16 + 2] = 9;
    expect(decodeEventAccount(badStatus)).toBeNull();
  });
});

describe("AccountChain", () => {
  const fakeSource =
    (accounts: Record<string, RawAccount>): AccountSource =>
    async (addrs) =>
      addrs.map((a) => accounts[a] ?? null);

  it("returns events only when owned by the program and valid", async () => {
    const host = (await makeWallet()).address;
    const pda1 = (await makeWallet()).address;
    const pda2 = (await makeWallet()).address;
    const data = encodeEventAccount(sampleOnChainEvent({ host }));
    const chain = new AccountChain(
      fakeSource({
        [pda1]: { owner: PROGRAM_ID, data },
        [pda2]: { owner: "11111111111111111111111111111111", data },
      })
    );
    expect((await chain.getEvent(pda1))?.host).toBe(host);
    expect(await chain.getEvent(pda2)).toBeNull();
    expect(await chain.getEvent(host)).toBeNull();
    expect((await chain.getEvents([pda2, pda1])).map((e) => !!e)).toEqual([
      false,
      true,
    ]);
  });

  it("derives the Ticket PDA and checks owner + discriminator", async () => {
    const event = (await makeWallet()).address;
    const member = (await makeWallet()).address;
    const stranger = (await makeWallet()).address;
    const enc = getAddressEncoder();
    const [ticketPda] = await getProgramDerivedAddress({
      programAddress: address(PROGRAM_ID),
      seeds: [
        new TextEncoder().encode("ticket"),
        enc.encode(address(event)),
        enc.encode(address(member)),
      ],
    });
    const ticketData = new Uint8Array(8 + 100);
    ticketData.set(accountDiscriminator("Ticket"));
    const chain = new AccountChain(
      fakeSource({ [ticketPda]: { owner: PROGRAM_ID, data: ticketData } })
    );
    expect(await chain.ticketExists(event, member)).toBe(true);
    expect(await chain.ticketExists(event, stranger)).toBe(false);

    const wrongDisc = new AccountChain(
      fakeSource({
        [ticketPda]: { owner: PROGRAM_ID, data: new Uint8Array(108) },
      })
    );
    expect(await wrongDisc.ticketExists(event, member)).toBe(false);
    const wrongOwner = new AccountChain(
      fakeSource({
        [ticketPda]: { owner: member, data: ticketData },
      })
    );
    expect(await wrongOwner.ticketExists(event, member)).toBe(false);
  });
});
