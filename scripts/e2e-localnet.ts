/**
 * Localnet end-to-end scenarios (run via `npm run e2e`, which starts a
 * validator first). Everything goes through the generated Codama client, real
 * PDAs, real account decoding, the real lib/qr crypto and the validator clock.
 * To add a scenario, write an async function and append it to SCENARIOS.
 */
import {
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
import {
  createCheckinPayload,
  generateTicketKey,
  verifyCheckinPayload,
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

export const SCENARIOS: Scenario[] = [
  { name: "lifecycle", run: lifecycle },
  { name: "cancel-refund", run: cancelRefund },
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
