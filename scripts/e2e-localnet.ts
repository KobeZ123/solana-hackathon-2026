/**
 * Localnet end-to-end scenarios (run via `npm run e2e`, which starts a
 * validator first). Everything goes through the generated Codama client, real
 * PDAs, real account decoding, the real lib/qr crypto and the validator clock.
 * To add a scenario, write an async function and append it to SCENARIOS.
 */
import {
  getApproveSponsorshipInstructionAsync,
  getConfirmDeliveryInstruction,
  getProposeSponsorshipInstructionAsync,
  getRegisterVendorInstructionAsync,
  getRejectSponsorshipInstruction,
  getReleaseSponsorshipInstructionAsync,
  getSettleVendorInstructionAsync,
  SponsorshipStatus,
  fetchSponsorship,
  fetchVendorProfile,
  findSponsorshipPda,
  findVendorProfilePda,
  getCancelEventInstruction,
  getCheckInInstructionAsync,
  getClaimInstructionAsync,
  getCreateEventInstructionAsync,
  getEndEventInstructionAsync,
  getJoinEventInstructionAsync,
  getRefundInstructionAsync,
  getSetGateInstruction,
  getWithdrawHostInstructionAsync,
  EventStatus,
  fetchEvent,
  fetchMaybeTicket,
  fetchTicket,
  findEventPda,
  findTicketPda,
  findVaultPda,
} from "../app/generated/event_pool";
import { offerHashBytes, offerHashHex } from "../app/lib/offer";
import {
  createCheckinPayload,
  createDeliveryPayload,
  generateTicketKey,
  generateVendorKey,
  verifyCheckinPayload,
  verifyDeliveryPayload,
} from "../app/lib/qr";
import {
  chainNow,
  fundedSigner,
  getBalance,
  rentMinimum,
  rpc,
  send,
  SIGNATURE_FEE,
  waitUntilChainPast,
  warmUp,
} from "./lib/chain";
import {
  check,
  checkEq,
  checkRejects,
  runScenarios,
  type Scenario,
} from "./lib/harness";
import type { Address, KeyPairSigner } from "@solana/kit";

const ENTRY_FEE = 10_000_010n; // chosen so attendee_pool / checked_in leaves dust
const PAYOUT_BPS = 3000;
const METADATA_HASH = new Uint8Array(32).fill(7);

type Member = {
  signer: KeyPairSigner;
  ticketKey: ReturnType<typeof generateTicketKey>;
  ticket: Address;
};

async function createEvent(
  host: KeyPairSigner,
  opts: { startTs: number; endTs: number; capacity?: number }
) {
  const eventId = BigInt(Date.now());
  const [event] = await findEventPda({ host: host.address, eventId });
  const [vault] = await findVaultPda({ event });
  await send(host, [
    await getCreateEventInstructionAsync({
      host,
      eventId,
      entryFee: ENTRY_FEE,
      capacity: opts.capacity ?? 10,
      startTs: opts.startTs,
      endTs: opts.endTs,
      payoutBps: PAYOUT_BPS,
      metadataHash: METADATA_HASH,
    }),
  ]);
  return { event, vault };
}

async function joinMember(event: Address): Promise<Member> {
  const signer = await fundedSigner(2n);
  const ticketKey = generateTicketKey();
  await send(signer, [
    await getJoinEventInstructionAsync({
      member: signer,
      event,
      ticketKey: ticketKey.publicKey as Address,
    }),
  ]);
  const [ticket] = await findTicketPda({ event, member: signer.address });
  return { signer, ticketKey, ticket };
}

const isoSecs = () => Math.floor(Date.now() / 1000);

async function lifecycle() {
  const rent = await rentMinimum(0n);
  checkEq("rent minimum for a 0-byte account is 890880", rent, 890_880n);

  const host = await fundedSigner(5n);
  const now = await chainNow();
  const startTs = now + 3;
  const endTs = startTs + 25;
  const { event, vault } = await createEvent(host, { startTs, endTs });

  let ev = (await fetchEvent(rpc, event, { commitment: "confirmed" })).data;
  checkEq("event host decoded", ev.host, host.address);
  checkEq("event status Open", ev.status, EventStatus.Open);
  checkEq("gate defaults to host", ev.gateAuthority, host.address);
  checkEq("vault funded with rent minimum", await getBalance(vault), rent);

  // 3 members join
  const members: Member[] = [];
  for (let i = 0; i < 3; i++) members.push(await joinMember(event));
  ev = (await fetchEvent(rpc, event, { commitment: "confirmed" })).data;
  checkEq("tickets_sold == 3", ev.ticketsSold, 3);
  checkEq(
    "vault holds rent + 3 fees",
    await getBalance(vault),
    rent + 3n * ENTRY_FEE
  );
  const t0 = (
    await fetchTicket(rpc, members[0].ticket, { commitment: "confirmed" })
  ).data;
  checkEq(
    "ticket_key stored on-chain",
    t0.ticketKey,
    members[0].ticketKey.publicKey
  );
  checkEq("ticket not checked in yet", t0.checkedIn, false);

  // Host delegates scanning to an ephemeral gate key
  const gate = await fundedSigner(1n);
  await send(host, [
    getSetGateInstruction({ host, event, gate: gate.address }),
  ]);
  ev = (await fetchEvent(rpc, event, { commitment: "confirmed" })).data;
  checkEq("gate_authority updated", ev.gateAuthority, gate.address);
  await checkRejects("host can no longer check in after set_gate", async () =>
    send(host, [
      await getCheckInInstructionAsync({
        gate: host,
        event,
        member: members[0].signer.address,
      }),
    ])
  );

  // QR verification path (what the scanner does) then on-chain check-in
  const eventStr = event as string;
  async function scan(
    m: Member,
    payload = createCheckinPayload({
      event: eventStr,
      member: m.signer.address,
      secretKey: m.ticketKey.secretKey,
    })
  ) {
    const onChain = await fetchTicket(rpc, m.ticket, {
      commitment: "confirmed",
    });
    return {
      verdict: verifyCheckinPayload(payload, onChain.data.ticketKey, {
        event: eventStr,
        member: m.signer.address,
      }),
    };
  }

  const tampered = createCheckinPayload({
    event: eventStr,
    member: members[0].signer.address,
    secretKey: members[0].ticketKey.secretKey,
  });
  tampered.member = members[2].signer.address;
  const tamperedVerdict = verifyCheckinPayload(
    tampered,
    members[0].ticketKey.publicKey
  );
  check(
    "tampered payload rejected",
    !tamperedVerdict.ok,
    JSON.stringify(tamperedVerdict)
  );

  const stale = createCheckinPayload({
    event: eventStr,
    member: members[0].signer.address,
    secretKey: members[0].ticketKey.secretKey,
    ts: isoSecs() - 120,
  });
  const staleVerdict = verifyCheckinPayload(
    stale,
    members[0].ticketKey.publicKey
  );
  check(
    "stale payload rejected",
    !staleVerdict.ok && staleVerdict.reason === "expired",
    JSON.stringify(staleVerdict)
  );

  const wrongKey = createCheckinPayload({
    event: eventStr,
    member: members[0].signer.address,
    secretKey: members[1].ticketKey.secretKey,
  });
  check(
    "payload signed with another ticket key rejected",
    !(await scan(members[0], wrongKey)).verdict.ok
  );

  for (const m of members.slice(0, 2)) {
    const { verdict } = await scan(m);
    check("fresh QR payload verifies against on-chain ticket_key", verdict.ok);
    await send(gate, [
      await getCheckInInstructionAsync({
        gate,
        event,
        member: m.signer.address,
      }),
    ]);
  }
  ev = (await fetchEvent(rpc, event, { commitment: "confirmed" })).data;
  checkEq("checked_in == 2", ev.checkedIn, 2);
  const tk = (
    await fetchTicket(rpc, members[0].ticket, { commitment: "confirmed" })
  ).data;
  check(
    "ticket marked checked in with timestamp",
    tk.checkedIn && tk.checkedInAt > 0n
  );
  await checkRejects("double check-in rejected", async () =>
    send(gate, [
      await getCheckInInstructionAsync({
        gate,
        event,
        member: members[0].signer.address,
      }),
    ])
  );
  await checkRejects("end_event before end_ts rejected", async () =>
    send(host, [await getEndEventInstructionAsync({ host, event })])
  );

  // Real clock: wait until the validator clock passes end_ts
  console.log(`  ...waiting for validator clock to pass end_ts (${endTs})`);
  await waitUntilChainPast(endTs);

  await checkRejects("join after end_ts rejected", async () => {
    const late = await fundedSigner(1n);
    await send(late, [
      await getJoinEventInstructionAsync({
        member: late,
        event,
        ticketKey: generateTicketKey().publicKey as Address,
      }),
    ]);
  });

  await send(host, [await getEndEventInstructionAsync({ host, event })]);
  ev = (await fetchEvent(rpc, event, { commitment: "confirmed" })).data;

  // Contract math
  const pool = 3n * ENTRY_FEE;
  const attendeePool = (pool * BigInt(PAYOUT_BPS)) / 10_000n;
  const hostBudget = pool - attendeePool;
  const share = attendeePool / 2n;
  const dust = attendeePool - share * 2n;
  checkEq("status Ended", ev.status, EventStatus.Ended);
  checkEq("attendee_pool matches contract math", ev.attendeePool, attendeePool);
  checkEq("host_budget matches contract math", ev.hostBudget, hostBudget);
  check("dust is non-zero (exercises dust path)", dust > 0n, `dust=${dust}`);

  // Claims
  for (const m of members.slice(0, 2)) {
    const before = await getBalance(m.signer.address);
    await send(m.signer, [
      await getClaimInstructionAsync({ member: m.signer, event }),
    ]);
    const after = await getBalance(m.signer.address);
    checkEq(
      "checked-in member claim pays exact share (minus tx fee)",
      after - before,
      share - SIGNATURE_FEE
    );
    await checkRejects("double claim rejected", async () =>
      send(m.signer, [
        await getClaimInstructionAsync({ member: m.signer, event }),
      ])
    );
  }
  await checkRejects("non-checked-in member claim rejected", async () =>
    send(members[2].signer, [
      await getClaimInstructionAsync({ member: members[2].signer, event }),
    ])
  );
  const t2 = await fetchMaybeTicket(rpc, members[0].ticket, {
    commitment: "confirmed",
  });
  check("claimed flag set", t2.exists && t2.data.claimed);

  // Host withdraw
  const hostBefore = await getBalance(host.address);
  await send(host, [await getWithdrawHostInstructionAsync({ host, event })]);
  const hostAfter = await getBalance(host.address);
  checkEq(
    "host withdraw = host_budget + dust (minus tx fee)",
    hostAfter - hostBefore,
    hostBudget + dust - SIGNATURE_FEE
  );
  await checkRejects("double withdraw rejected", async () =>
    send(host, [await getWithdrawHostInstructionAsync({ host, event })])
  );
  checkEq("vault ends at rent minimum", await getBalance(vault), rent);
}

async function cancelRefund() {
  const rent = await rentMinimum(0n);
  const host = await fundedSigner(5n);
  const now = await chainNow();
  const { event, vault } = await createEvent(host, {
    startTs: now + 3600 * 2,
    endTs: now + 3600 * 3,
  });
  const members = [await joinMember(event), await joinMember(event)];
  checkEq(
    "vault holds rent + 2 fees",
    await getBalance(vault),
    rent + 2n * ENTRY_FEE
  );

  await checkRejects("refund before cancel rejected", async () =>
    send(members[0].signer, [
      await getRefundInstructionAsync({ member: members[0].signer, event }),
    ])
  );
  await send(host, [getCancelEventInstruction({ host, event })]);
  const ev = (await fetchEvent(rpc, event, { commitment: "confirmed" })).data;
  checkEq("status Cancelled", ev.status, EventStatus.Cancelled);

  for (const m of members) {
    const ticketLamports = await getBalance(m.ticket);
    const before = await getBalance(m.signer.address);
    await send(m.signer, [
      await getRefundInstructionAsync({ member: m.signer, event }),
    ]);
    const after = await getBalance(m.signer.address);
    checkEq(
      "refund returns entry fee + ticket rent (minus tx fee)",
      after - before,
      ENTRY_FEE + ticketLamports - SIGNATURE_FEE
    );
    const t = await fetchMaybeTicket(rpc, m.ticket, {
      commitment: "confirmed",
    });
    check("ticket account closed", !t.exists);
  }
  checkEq("vault at rent minimum after refunds", await getBalance(vault), rent);
  const ev2 = (await fetchEvent(rpc, event, { commitment: "confirmed" })).data;
  checkEq("tickets_sold back to 0", ev2.ticketsSold, 0);
  await checkRejects("join cancelled event rejected", async () => {
    await joinMember(event);
  });
}

type Vendor = {
  signer: KeyPairSigner;
  key: ReturnType<typeof generateVendorKey>;
  sponsorship: Address;
};

/** register_vendor + propose_sponsorship (offer hash from the shared offer lib). */
async function registerAndPropose(
  event: Address,
  amount: bigint,
  text: string
): Promise<Vendor> {
  const signer = await fundedSigner(2n);
  const key = generateVendorKey();
  await send(signer, [
    await getRegisterVendorInstructionAsync({
      vendor: signer,
      vendorKey: key.publicKey as Address,
    }),
  ]);
  await send(signer, [
    await getProposeSponsorshipInstructionAsync({
      vendor: signer,
      event,
      amount,
      offerHash: await offerHashBytes(text),
    }),
  ]);
  const [sponsorship] = await findSponsorshipPda({
    event,
    vendor: signer.address,
  });
  return { signer, key, sponsorship };
}

const sponsorshipOf = async (v: Vendor) =>
  (await fetchSponsorship(rpc, v.sponsorship, { commitment: "confirmed" }))
    .data;
const eventOf = async (event: Address) =>
  (await fetchEvent(rpc, event, { commitment: "confirmed" })).data;

async function vendorFlow() {
  const rent = await rentMinimum(0n);
  const host = await fundedSigner(5n);
  const now = await chainNow();
  const endTs = now + 3 + 22;
  const { event, vault } = await createEvent(host, {
    startTs: now + 3,
    endTs,
  });
  const eventStr = event as string;

  const members: Member[] = [];
  for (let i = 0; i < 3; i++) members.push(await joinMember(event));
  const gate = await fundedSigner(1n);
  await send(host, [
    getSetGateInstruction({ host, event, gate: gate.address }),
  ]);
  for (const m of members.slice(0, 2)) {
    await send(gate, [
      await getCheckInInstructionAsync({
        gate,
        event,
        member: m.signer.address,
      }),
    ]);
  }

  // Vendor registers; the VendorProfile holds the QR key
  const text = "50 tacos for the crowd";
  const AMOUNT = 6_000_000n;
  const vendor = await registerAndPropose(event, AMOUNT, text);
  const profile = (
    await fetchVendorProfile(
      rpc,
      (await findVendorProfilePda({ vendor: vendor.signer.address }))[0],
      { commitment: "confirmed" }
    )
  ).data;
  checkEq(
    "VendorProfile.vendor_key stored",
    profile.vendorKey,
    vendor.key.publicKey
  );
  let sp = await sponsorshipOf(vendor);
  checkEq("sponsorship Proposed", sp.status, SponsorshipStatus.Proposed);
  checkEq("sponsorship amount", sp.amount, AMOUNT);
  checkEq(
    "on-chain offer_hash equals the lib's offerHashHex",
    Buffer.from(sp.offerHash).toString("hex"),
    await offerHashHex(text)
  );

  // Approval is host-only and capped by the host's share of the pool
  await checkRejects("non-host cannot approve", async () =>
    send(vendor.signer, [
      await getApproveSponsorshipInstructionAsync({
        host: vendor.signer,
        event,
        sponsorship: vendor.sponsorship,
      }),
    ])
  );
  const pool = 3n * ENTRY_FEE;
  const cap = (pool * BigInt(10_000 - PAYOUT_BPS)) / 10_000n;
  const big = await registerAndPropose(event, cap, "everything");
  await send(host, [
    await getApproveSponsorshipInstructionAsync({
      host,
      event,
      sponsorship: vendor.sponsorship,
    }),
  ]);
  checkEq(
    "approved_sponsor_total == amount",
    (await eventOf(event)).approvedSponsorTotal,
    AMOUNT
  );
  await checkRejects(
    "approval beyond host budget cap fails (SponsorshipBudgetExceeded 6018)",
    async () =>
      send(host, [
        await getApproveSponsorshipInstructionAsync({
          host,
          event,
          sponsorship: big.sponsorship,
        }),
      ]),
    /0x1782|SponsorshipBudgetExceeded/
  );
  await send(host, [
    getRejectSponsorshipInstruction({
      host,
      event,
      sponsorship: big.sponsorship,
    }),
  ]);
  checkEq(
    "over-cap sponsorship Rejected",
    (await sponsorshipOf(big)).status,
    SponsorshipStatus.Rejected
  );
  checkEq(
    "rejecting does not change approved_sponsor_total",
    (await eventOf(event)).approvedSponsorTotal,
    AMOUNT
  );

  // Vendor QR (delivery:) verified against the on-chain vendor_key, then confirm_delivery
  const qr = createDeliveryPayload({
    event: eventStr,
    vendor: vendor.signer.address,
    secretKey: vendor.key.secretKey,
  });
  const verdict = verifyDeliveryPayload(qr, profile.vendorKey, {
    event: eventStr,
    vendor: vendor.signer.address,
  });
  check(
    "fresh delivery QR verifies against VendorProfile.vendor_key",
    verdict.ok
  );
  check(
    "delivery QR signed by another key rejected",
    !verifyDeliveryPayload(
      createDeliveryPayload({
        event: eventStr,
        vendor: vendor.signer.address,
        secretKey: generateVendorKey().secretKey,
      }),
      profile.vendorKey
    ).ok
  );
  check(
    "stale delivery QR rejected",
    !verifyDeliveryPayload(
      createDeliveryPayload({
        event: eventStr,
        vendor: vendor.signer.address,
        secretKey: vendor.key.secretKey,
        ts: isoSecs() - 120,
      }),
      profile.vendorKey
    ).ok
  );
  await checkRejects(
    "host (no longer the gate) cannot confirm delivery",
    async () =>
      send(host, [
        getConfirmDeliveryInstruction({
          gate: host,
          event,
          sponsorship: vendor.sponsorship,
        }),
      ])
  );
  await checkRejects(
    "confirm_delivery on a Rejected sponsorship fails",
    async () =>
      send(gate, [
        getConfirmDeliveryInstruction({
          gate,
          event,
          sponsorship: big.sponsorship,
        }),
      ])
  );
  await send(gate, [
    getConfirmDeliveryInstruction({
      gate,
      event,
      sponsorship: vendor.sponsorship,
    }),
  ]);
  sp = await sponsorshipOf(vendor);
  checkEq("sponsorship Delivered", sp.status, SponsorshipStatus.Delivered);

  const settle = async (payer: KeyPairSigner, v: Vendor) =>
    send(payer, [
      await getSettleVendorInstructionAsync({
        payer,
        event,
        sponsorship: v.sponsorship,
        vendor: v.signer.address,
      }),
    ]);
  await checkRejects("settle_vendor before the event ended fails", () =>
    settle(members[2].signer, vendor)
  );

  console.log(`  ...waiting for validator clock to pass end_ts (${endTs})`);
  await waitUntilChainPast(endTs);
  await send(host, [await getEndEventInstructionAsync({ host, event })]);
  const ev = await eventOf(event);
  const attendeePool = (pool * BigInt(PAYOUT_BPS)) / 10_000n;
  const hostBudget = pool - attendeePool;
  checkEq(
    "attendee_pool unaffected by sponsorship",
    ev.attendeePool,
    attendeePool
  );
  checkEq("host_budget unaffected by sponsorship", ev.hostBudget, hostBudget);

  await checkRejects("settle of a Rejected sponsorship fails", () =>
    settle(members[2].signer, big)
  );
  // Anyone can settle: a random attendee pays the fee, the vendor receives exactly amount
  const vBefore = await getBalance(vendor.signer.address);
  const payer = members[2].signer;
  const pBefore = await getBalance(payer.address);
  await settle(payer, vendor);
  checkEq(
    "vendor receives exactly the sponsorship amount",
    (await getBalance(vendor.signer.address)) - vBefore,
    AMOUNT
  );
  checkEq(
    "settle payer only pays the tx fee",
    pBefore - (await getBalance(payer.address)),
    SIGNATURE_FEE
  );
  checkEq(
    "sponsorship Paid",
    (await sponsorshipOf(vendor)).status,
    SponsorshipStatus.Paid
  );
  await checkRejects("double settle rejected", () => settle(payer, vendor));

  // Attendee pool is untouched: exact shares
  const share = attendeePool / 2n;
  const dust = attendeePool - share * 2n;
  for (const m of members.slice(0, 2)) {
    const before = await getBalance(m.signer.address);
    await send(m.signer, [
      await getClaimInstructionAsync({ member: m.signer, event }),
    ]);
    checkEq(
      "claim pays the full share despite the vendor payout",
      (await getBalance(m.signer.address)) - before,
      share - SIGNATURE_FEE
    );
  }
  const hBefore = await getBalance(host.address);
  await send(host, [await getWithdrawHostInstructionAsync({ host, event })]);
  checkEq(
    "host withdraw = host_budget - sponsor total + dust",
    (await getBalance(host.address)) - hBefore,
    hostBudget - AMOUNT + dust - SIGNATURE_FEE
  );
  checkEq("vault ends at rent minimum", await getBalance(vault), rent);
}

async function vendorRelease() {
  const rent = await rentMinimum(0n);
  const host = await fundedSigner(5n);
  const now = await chainNow();
  const endTs = now + 3 + 20;
  const { event, vault } = await createEvent(host, {
    startTs: now + 3,
    endTs,
  });
  const members = [await joinMember(event), await joinMember(event)];
  await send(host, [
    await getCheckInInstructionAsync({
      gate: host,
      event,
      member: members[0].signer.address,
    }),
  ]);
  const A = await registerAndPropose(event, 3_000_000n, "A");
  const B = await registerAndPropose(event, 2_000_000n, "B");
  const C = await registerAndPropose(event, 1_000_000n, "C (never approved)");
  for (const v of [A, B]) {
    await send(host, [
      await getApproveSponsorshipInstructionAsync({
        host,
        event,
        sponsorship: v.sponsorship,
      }),
    ]);
  }
  checkEq(
    "approved_sponsor_total == 5_000_000",
    (await eventOf(event)).approvedSponsorTotal,
    5_000_000n
  );
  const release = async (v: Vendor) =>
    send(host, [
      await getReleaseSponsorshipInstructionAsync({
        host,
        event,
        sponsorship: v.sponsorship,
      }),
    ]);
  await checkRejects("release before the event ended fails", () => release(A));

  await waitUntilChainPast(endTs);
  await send(host, [await getEndEventInstructionAsync({ host, event })]);
  const pool = 2n * ENTRY_FEE;
  const attendeePool = (pool * BigInt(PAYOUT_BPS)) / 10_000n;
  const hostBudget = pool - attendeePool;
  const ev = await eventOf(event);
  checkEq("attendee_pool as expected", ev.attendeePool, attendeePool);

  await checkRejects("release of a Proposed sponsorship fails", () =>
    release(C)
  );
  let hb = await getBalance(host.address);
  await release(A);
  checkEq(
    "release before withdraw moves no lamports (only tx fee)",
    hb - (await getBalance(host.address)),
    SIGNATURE_FEE
  );
  checkEq(
    "released sponsorship is Rejected",
    (await sponsorshipOf(A)).status,
    SponsorshipStatus.Rejected
  );
  checkEq(
    "approved_sponsor_total decremented",
    (await eventOf(event)).approvedSponsorTotal,
    2_000_000n
  );
  await checkRejects("double release fails", () => release(A));

  hb = await getBalance(host.address);
  await send(host, [await getWithdrawHostInstructionAsync({ host, event })]);
  checkEq(
    "withdraw keeps the remaining reservation in the vault",
    (await getBalance(host.address)) - hb,
    hostBudget - 2_000_000n - SIGNATURE_FEE
  );
  // Release after withdraw pays the freed amount out immediately
  hb = await getBalance(host.address);
  await release(B);
  checkEq(
    "release after withdraw pays the reservation to the host",
    (await getBalance(host.address)) - hb,
    2_000_000n - SIGNATURE_FEE
  );
  const before = await getBalance(members[0].signer.address);
  await send(members[0].signer, [
    await getClaimInstructionAsync({ member: members[0].signer, event }),
  ]);
  checkEq(
    "sole checked-in member claims the whole attendee pool",
    (await getBalance(members[0].signer.address)) - before,
    attendeePool - SIGNATURE_FEE
  );
  checkEq("vault ends at rent minimum", await getBalance(vault), rent);
}

export const SCENARIOS: Scenario[] = [
  { name: "lifecycle", run: lifecycle },
  { name: "cancel-refund", run: cancelRefund },
  { name: "vendor", run: vendorFlow },
  { name: "vendor-release", run: vendorRelease },
];

warmUp()
  .then(() => runScenarios(SCENARIOS))
  .then(
    (code) => process.exit(code),
    (e) => {
      console.error(e);
      process.exit(1);
    }
  );
