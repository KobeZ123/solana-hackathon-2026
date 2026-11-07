/**
 * Seed a local validator (and the API's JSON store) with demo data so the app looks lived-in
 * without paying anything. Run via `npm run seed` (which starts the validator and keeps it up).
 *
 * Creates, through the real generated client: upcoming, nearly-full, members-only, live, ended
 * (with claims and a settled vendor) and cancelled (with a refund) events, plus vendors with
 * pending and approved sponsorships. All wallets are throwaway; env SEED_FUND=<addr,addr> also
 * airdrops free localnet SOL to your own wallet(s) so you can host and join right away.
 */
import {
  fetchEvent,
  findEventPda,
  findSponsorshipPda,
  getApproveSponsorshipInstructionAsync,
  getCancelEventInstruction,
  getCheckInInstructionAsync,
  getClaimInstructionAsync,
  getConfirmDeliveryInstruction,
  getCreateEventInstructionAsync,
  getEndEventInstructionAsync,
  getJoinEventInstructionAsync,
  getProposeSponsorshipInstructionAsync,
  getRefundInstructionAsync,
  getRegisterVendorInstructionAsync,
  getSettleVendorInstructionAsync,
} from "../app/generated/event_pool";
import { metadataHashBytes, metadataHashHex } from "../app/lib/metadata";
import { offerHashBytes, offerHashHex } from "../app/lib/offer";
import { generateTicketKey, generateVendorKey } from "../app/lib/qr";
import { FileStore } from "../app/lib/server/store-file";
import type { Visibility } from "../app/lib/server/store";
import {
  airdrop,
  chainNow,
  fundedSigner,
  rpc,
  send,
  waitUntilChainPast,
  warmUp,
} from "./lib/chain";
import type { Address, KeyPairSigner } from "@solana/kit";

const SOL = 1_000_000_000n;
const sol = (x: number) => BigInt(Math.round(x * 1e9));
const DAY = 86_400;
const APP_URL = process.env.SEED_APP_URL ?? "http://localhost:3000";

const store = new FileStore(process.env.STORE_FILE ?? ".data/store.json");

let counter = 0;
const log = (m: string) => console.log(`[seed] ${m}`);

interface Spec {
  title: string;
  summary: string;
  location: string;
  description: string;
  visibility?: Visibility;
  host: KeyPairSigner;
  feeSol: number;
  capacity: number;
  startOffset: number; // seconds from now
  endOffset: number;
  payoutBps: number;
}

interface Made {
  spec: Spec;
  event: Address;
}

async function makeEvent(spec: Spec): Promise<Made> {
  const now = await chainNow();
  const eventId = BigInt(Date.now()) + BigInt(counter++);
  const [event] = await findEventPda({ host: spec.host.address, eventId });
  const meta = {
    title: spec.title,
    summary: spec.summary,
    coverUrl: null,
    details: { location: spec.location, description: spec.description },
  };
  await send(spec.host, [
    await getCreateEventInstructionAsync({
      host: spec.host,
      eventId,
      entryFee: sol(spec.feeSol),
      capacity: spec.capacity,
      startTs: now + spec.startOffset,
      endTs: now + spec.endOffset,
      payoutBps: spec.payoutBps,
      metadataHash: await metadataHashBytes(meta),
    }),
  ]);
  await store.insertEvent({
    eventPda: event,
    hostWallet: spec.host.address,
    title: meta.title,
    summary: meta.summary,
    coverUrl: null,
    details: meta.details,
    metadataHash: await metadataHashHex(meta),
    visibility: spec.visibility ?? "public",
    createdAt: new Date().toISOString(),
  });
  log(`created: ${spec.title}`);
  return { spec, event };
}

async function join(member: KeyPairSigner, event: Address) {
  await send(member, [
    await getJoinEventInstructionAsync({
      member,
      event,
      ticketKey: generateTicketKey().publicKey as Address,
    }),
  ]);
}

async function checkIn(gate: KeyPairSigner, event: Address, member: Address) {
  await send(gate, [await getCheckInInstructionAsync({ gate, event, member })]);
}

interface Vendor {
  signer: KeyPairSigner;
  name: string;
  description: string;
}

async function proposeSponsorship(
  v: Vendor,
  made: Made,
  amountSol: number,
  text: string
) {
  const [sponsorship] = await findSponsorshipPda({
    event: made.event,
    vendor: v.signer.address,
  });
  await send(v.signer, [
    await getProposeSponsorshipInstructionAsync({
      vendor: v.signer,
      event: made.event,
      amount: sol(amountSol),
      offerHash: await offerHashBytes(text),
    }),
  ]);
  await store.upsertOffer({
    eventPda: made.event,
    vendorWallet: v.signer.address,
    text,
    offerHash: await offerHashHex(text),
    updatedAt: new Date().toISOString(),
  });
  return sponsorship;
}

async function approve(host: KeyPairSigner, event: Address, sp: Address) {
  await send(host, [
    await getApproveSponsorshipInstructionAsync({
      host,
      event,
      sponsorship: sp,
    }),
  ]);
}

async function main() {
  await warmUp();
  const store0 = await store.listEvents();
  if (store0.length) log(`note: store already has ${store0.length} events`);

  // ---- wallets (all funded from the free local faucet)
  log("funding wallets...");
  const hosts = [await fundedSigner(20n), await fundedSigner(20n)];
  const [maya, devon] = hosts;
  const members: KeyPairSigner[] = [];
  for (let i = 0; i < 16; i++) members.push(await fundedSigner(5n));
  const vendors: Vendor[] = [
    {
      signer: await fundedSigner(3n),
      name: "Taco Cart Co.",
      description: "Street tacos and aguas frescas for community events.",
    },
    {
      signer: await fundedSigner(3n),
      name: "Brewline Coffee",
      description: "Mobile espresso bar, up to 80 cups an hour.",
    },
    {
      signer: await fundedSigner(3n),
      name: "SoundLab Rentals",
      description: "PA systems and mics for small venues.",
    },
  ];
  const vendorKeys = vendors.map(() => generateVendorKey());
  for (let i = 0; i < vendors.length; i++) {
    await send(vendors[i].signer, [
      await getRegisterVendorInstructionAsync({
        vendor: vendors[i].signer,
        vendorKey: vendorKeys[i].publicKey as Address,
      }),
    ]);
    await store.upsertVendor({
      wallet: vendors[i].signer.address,
      name: vendors[i].name,
      logoUrl: null,
      description: vendors[i].description,
      updatedAt: new Date().toISOString(),
    });
  }

  // ---- 1) the event that will END (needs a short window; settled at the end)
  const past = await makeEvent({
    title: "Hack Night Recap",
    summary: "Pizza, laptops and a demo round. Payouts already settled.",
    location: "Mission Creek Co-working, 2nd floor",
    description:
      "Bring a project. We ran five-minute demos and split the pool.",
    host: maya,
    feeSol: 0.1,
    capacity: 20,
    startOffset: 3,
    endOffset: 120,
    payoutBps: 3000,
  });
  for (const m of members.slice(0, 8)) await join(m, past.event);
  for (const m of members.slice(0, 6))
    await checkIn(maya, past.event, m.address);
  const pastSp = await proposeSponsorship(
    vendors[0],
    past,
    0.12,
    "Taco cart for 40 guests, served at 7pm."
  );
  await approve(maya, past.event, pastSp);
  await send(maya, [
    getConfirmDeliveryInstruction({
      gate: maya,
      event: past.event,
      sponsorship: pastSp,
    }),
  ]);

  // ---- 2) live now (started a moment ago, runs for days)
  const live = await makeEvent({
    title: "Friday Night Jam",
    summary: "Open-mic and a potluck. Doors are open now.",
    location: "Riverside Park pavilion",
    description: "Bring an instrument or just good company.",
    host: devon,
    feeSol: 0.08,
    capacity: 30,
    startOffset: 3,
    endOffset: 3 * DAY,
    payoutBps: 2500,
  });
  for (const m of members.slice(2, 11)) await join(m, live.event);
  for (const m of members.slice(2, 8))
    await checkIn(devon, live.event, m.address);

  // ---- 3) upcoming events
  const rooftop = await makeEvent({
    title: "Rooftop Sunset Meetup",
    summary: "Golden-hour drinks and introductions. Newcomers welcome.",
    location: "The Wren, 14th floor terrace",
    description: "Small group, big views. Name tags provided.",
    host: maya,
    feeSol: 0.1,
    capacity: 40,
    startOffset: 2 * DAY,
    endOffset: 2 * DAY + 4 * 3600,
    payoutBps: 3000,
  });
  for (const m of members.slice(0, 7)) await join(m, rooftop.event);
  const rooftopApproved = await proposeSponsorship(
    vendors[1],
    rooftop,
    0.05,
    "Espresso bar from 5 to 8pm, two baristas."
  );
  await approve(maya, rooftop.event, rooftopApproved);
  await proposeSponsorship(
    vendors[2],
    rooftop,
    0.04,
    "Speaker and wireless mic for the welcome toast."
  );

  const boardgames = await makeEvent({
    title: "Saturday Board Game Night",
    summary: "Nearly full. Co-op and party games, snacks provided.",
    location: "Pixel & Pawn cafe",
    description: "Bring a game or borrow ours. Beginners welcome.",
    host: devon,
    feeSol: 0.05,
    capacity: 12,
    startOffset: 5 * DAY,
    endOffset: 5 * DAY + 4 * 3600,
    payoutBps: 2500,
  });
  for (const m of members.slice(0, 11)) await join(m, boardgames.event);

  const breakfast = await makeEvent({
    title: "Builder Breakfast",
    summary: "Early coffee for people shipping things.",
    location: "Corner Bakery, back room",
    description: "Share what you are building. Tell us what is blocking you.",
    host: maya,
    feeSol: 0.02,
    capacity: 25,
    startOffset: 9 * DAY,
    endOffset: 9 * DAY + 2 * 3600,
    payoutBps: 4000,
  });
  for (const m of members.slice(5, 8)) await join(m, breakfast.event);

  const circle = await makeEvent({
    title: "Solana Study Circle (members only)",
    summary: "Visible only to people connected through past events.",
    location: "Shared in-app after you join",
    description: "Weekly walk-through of a Solana program, led by members.",
    visibility: "network",
    host: devon,
    feeSol: 0.03,
    capacity: 15,
    startOffset: 3 * DAY,
    endOffset: 3 * DAY + 2 * 3600,
    payoutBps: 2000,
  });
  for (const m of members.slice(0, 4)) await join(m, circle.event);

  // ---- 4) cancelled with a refund
  const picnic = await makeEvent({
    title: "Lakeside Picnic (cancelled)",
    summary: "Rained out. Everyone is being refunded.",
    location: "Lake Merritt, east lawn",
    description: "Potluck and frisbee.",
    host: devon,
    feeSol: 0.04,
    capacity: 20,
    startOffset: DAY,
    endOffset: DAY + 4 * 3600,
    payoutBps: 2500,
  });
  for (const m of members.slice(8, 11)) await join(m, picnic.event);
  await send(devon, [
    getCancelEventInstruction({ host: devon, event: picnic.event }),
  ]);
  await send(members[8], [
    await getRefundInstructionAsync({
      member: members[8],
      event: picnic.event,
    }),
  ]);

  // ---- 5) finish the ended event once its window has passed
  log("waiting for the Hack Night window to close...");
  const ev = (await fetchEvent(rpc, past.event, { commitment: "confirmed" }))
    .data;
  await waitUntilChainPast(Number(ev.endTs));
  await send(maya, [
    await getEndEventInstructionAsync({ host: maya, event: past.event }),
  ]);
  for (const m of members.slice(0, 3)) {
    await send(m, [
      await getClaimInstructionAsync({ member: m, event: past.event }),
    ]);
  }
  await send(maya, [
    await getSettleVendorInstructionAsync({
      payer: maya,
      event: past.event,
      sponsorship: pastSp,
      vendor: vendors[0].signer.address,
    }),
  ]);

  // ---- optional: fund the user's own wallet(s)
  const fund = (process.env.SEED_FUND ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const addr of fund) {
    await airdrop(addr as Address, 50n * SOL);
    log(`airdropped 50 SOL to ${addr}`);
  }

  console.log("\n[seed] done. Events:");
  for (const m of [
    live,
    rooftop,
    boardgames,
    breakfast,
    circle,
    past,
    picnic,
  ]) {
    console.log(`  ${m.spec.title}\n    ${APP_URL}/events/${m.event}`);
  }
}

main().catch((e) => {
  console.error("[seed] FAILED:", e);
  process.exit(1);
});
