import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as getDetailsRoute } from "../../api/events/[pda]/details/route";
import { GET as getEventRoute } from "../../api/events/[pda]/route";
import { GET as listRoute, POST as createRoute } from "../../api/events/route";
import { metadataHashHex, type EventMetadata } from "../metadata";
import { signToken } from "./auth";
import { FakeChain, sampleOnChainEvent } from "./chain-testing";
import { setChain } from "./chain";
import {
  createEvent,
  getEventDetails,
  getEventSummary,
  listEvents,
} from "./events";
import { setStore } from "./store";
import { makeWallet, tempFileStore, type TestWallet } from "./testing";

const meta: EventMetadata = {
  title: "Rooftop meetup",
  summary: "Drinks and demos",
  coverUrl: null,
  details: { location: "12 Secret St", notes: ["bring ID"] },
};

let chain: FakeChain;
let store: ReturnType<typeof tempFileStore>;
let host: TestWallet;
let pda: string;

async function registerOnChain(over: Partial<EventMetadata> = {}) {
  const hash = await metadataHashHex({ ...meta, ...over });
  chain.events.set(
    pda,
    sampleOnChainEvent({ host: host.address, metadataHash: hash })
  );
}

const body = (over: Record<string, unknown> = {}) => ({
  eventPda: pda,
  ...meta,
  ...over,
});

beforeEach(async () => {
  chain = new FakeChain();
  store = tempFileStore();
  host = await makeWallet();
  pda = (await makeWallet()).address; // any valid address works as a fake PDA
  process.env.JWT_SECRET = "test-secret";
  setStore(store);
  setChain(chain);
});
afterEach(() => {
  setStore(undefined);
  setChain(undefined);
});

describe("createEvent", () => {
  it("stores metadata when host and hash match; returns merged summary", async () => {
    await registerOnChain();
    const s = await createEvent({ wallet: host.address }, body(), {
      store,
      chain,
    });
    expect(s.title).toBe(meta.title);
    expect(s.onchain?.entryFee).toBe("50000000");
    expect((await store.getEvent(pda))?.hostWallet).toBe(host.address);
  });

  it("rejects when the caller is not the on-chain host (403)", async () => {
    await registerOnChain();
    const other = await makeWallet();
    await expect(
      createEvent({ wallet: other.address }, body(), { store, chain })
    ).rejects.toMatchObject({ status: 403 });
    expect(await store.getEvent(pda)).toBeNull();
  });

  it("rejects when the metadata hash differs (400)", async () => {
    await registerOnChain();
    await expect(
      createEvent({ wallet: host.address }, body({ title: "Changed" }), {
        store,
        chain,
      })
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      createEvent(
        { wallet: host.address },
        body({ details: { location: "elsewhere" } }),
        { store, chain }
      )
    ).rejects.toMatchObject({ status: 400 });
  });

  it("404 when the event account does not exist, 409 on duplicate, 400 on bad input", async () => {
    await expect(
      createEvent({ wallet: host.address }, body(), { store, chain })
    ).rejects.toMatchObject({ status: 404 });
    await registerOnChain();
    await createEvent({ wallet: host.address }, body(), { store, chain });
    await expect(
      createEvent({ wallet: host.address }, body(), { store, chain })
    ).rejects.toMatchObject({ status: 409 });
    for (const bad of [
      { eventPda: "nope" },
      { title: "" },
      { details: undefined },
      { coverUrl: "javascript:alert(1)" },
      { visibility: "secret" },
    ]) {
      await expect(
        createEvent({ wallet: host.address }, body(bad), { store, chain })
      ).rejects.toMatchObject({ status: 400 });
    }
  });

  it("hash covers coverUrl (included when provided)", async () => {
    const cover = "https://img.example/c.png";
    await registerOnChain({ coverUrl: cover });
    const s = await createEvent(
      { wallet: host.address },
      body({ coverUrl: cover }),
      { store, chain }
    );
    expect(s.coverUrl).toBe(cover);
  });
});

describe("summaries", () => {
  beforeEach(async () => {
    await registerOnChain();
    await createEvent({ wallet: host.address }, body(), { store, chain });
  });

  it("merges stored data with live chain data", async () => {
    chain.events.set(
      pda,
      sampleOnChainEvent({
        host: host.address,
        metadataHash: "00".repeat(32),
        ticketsSold: 42,
        status: "cancelled",
      })
    );
    const s = await getEventSummary(pda, null, { store, chain });
    expect(s).toMatchObject({
      title: meta.title,
      hostWallet: host.address,
      onchain: { ticketsSold: 42, status: "cancelled", capacity: 100 },
    });
    expect(s).not.toHaveProperty("details");
    const list = await listEvents(null, { store, chain });
    expect(list).toHaveLength(1);
    expect(list[0].onchain?.ticketsSold).toBe(42);
  });

  it("unknown event is 404, invalid address 400", async () => {
    const other = (await makeWallet()).address;
    await expect(
      getEventSummary(other, null, { store, chain })
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      getEventSummary("bad", null, { store, chain })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("degrades to onchain: null when RPC fails", async () => {
    chain.failRpc = true;
    expect(
      (await getEventSummary(pda, null, { store, chain })).onchain
    ).toBeNull();
    expect((await listEvents(null, { store, chain }))[0].onchain).toBeNull();
  });

  it("network-visibility events are hidden from non-hosts", async () => {
    const pda2 = (await makeWallet()).address;
    chain.events.set(
      pda2,
      sampleOnChainEvent({
        host: host.address,
        metadataHash: await metadataHashHex(meta),
      })
    );
    await createEvent(
      { wallet: host.address },
      body({ eventPda: pda2, visibility: "network" }),
      { store, chain }
    );
    expect(await listEvents(null, { store, chain })).toHaveLength(1);
    expect(
      await listEvents({ wallet: host.address }, { store, chain })
    ).toHaveLength(2);
    await expect(
      getEventSummary(pda2, null, { store, chain })
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      getEventSummary(pda2, { wallet: host.address }, { store, chain })
    ).resolves.toBeTruthy();
  });
});

describe("details gating", () => {
  beforeEach(async () => {
    await registerOnChain();
    await createEvent({ wallet: host.address }, body(), { store, chain });
  });

  it("403 without a ticket, 200 with a ticket, 200 for the host", async () => {
    const member = await makeWallet();
    await expect(
      getEventDetails(pda, { wallet: member.address }, { store, chain })
    ).rejects.toMatchObject({ status: 403 });

    chain.tickets.add(`${pda}:${member.address}`);
    const d = await getEventDetails(
      pda,
      { wallet: member.address },
      { store, chain }
    );
    expect(d.details).toEqual(meta.details);

    const h = await getEventDetails(
      pda,
      { wallet: host.address },
      { store, chain }
    );
    expect(h.details).toEqual(meta.details);
  });

  it("404 for unknown events, 502 when the chain cannot be read", async () => {
    const member = await makeWallet();
    const other = (await makeWallet()).address;
    await expect(
      getEventDetails(other, { wallet: member.address }, { store, chain })
    ).rejects.toMatchObject({ status: 404 });
    chain.failRpc = true;
    await expect(
      getEventDetails(pda, { wallet: member.address }, { store, chain })
    ).rejects.toMatchObject({ status: 502 });
  });
});

describe("route handlers (global store/chain, JWT)", () => {
  const req = (url: string, init: RequestInit = {}, token?: string) =>
    new Request(`http://x${url}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });

  it("POST /api/events requires auth, then creates (201)", async () => {
    await registerOnChain();
    const post = (token?: string) =>
      createRoute(
        req(
          "/api/events",
          { method: "POST", body: JSON.stringify(body()) },
          token
        )
      );
    expect((await post()).status).toBe(401);
    const token = await signToken(host.address);
    const res = await post(token);
    expect(res.status).toBe(201);
    expect((await res.json()).eventPda).toBe(pda);
    expect((await post(token)).status).toBe(409);
  });

  it("GET list / summary / details end to end", async () => {
    await registerOnChain();
    await createEvent({ wallet: host.address }, body());
    const member = await makeWallet();
    const memberToken = await signToken(member.address);
    const params = { params: Promise.resolve({ pda }) };

    const list = await (await listRoute(req("/api/events"))).json();
    expect(list.events).toHaveLength(1);
    expect(
      (await getEventRoute(req(`/api/events/${pda}`), params)).status
    ).toBe(200);

    const details = (token?: string) =>
      getDetailsRoute(req(`/api/events/${pda}/details`, {}, token), params);
    expect((await details()).status).toBe(401);
    expect((await details(memberToken)).status).toBe(403);
    chain.tickets.add(`${pda}:${member.address}`);
    const ok = await details(memberToken);
    expect(ok.status).toBe(200);
    expect((await ok.json()).details).toEqual(meta.details);
  });
});
