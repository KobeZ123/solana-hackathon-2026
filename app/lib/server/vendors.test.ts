import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  GET as getOffersRoute,
  POST as postOfferRoute,
} from "../../api/events/[pda]/offers/route";
import { GET as getVendorRoute } from "../../api/vendors/[wallet]/route";
import { POST as postVendorRoute } from "../../api/vendors/route";
import { offerHashHex } from "../offer";
import { signToken } from "./auth";
import { setChain } from "./chain";
import { FakeChain, sampleOnChainEvent } from "./chain-testing";
import { setStore } from "./store";
import { makeWallet, tempFileStore, type TestWallet } from "./testing";
import {
  getVendorView,
  listOffers,
  putOffer,
  upsertVendorProfile,
} from "./vendors";

let chain: FakeChain;
let store: ReturnType<typeof tempFileStore>;
let host: TestWallet;
let vendor: TestWallet;
let other: TestWallet;
let pda: string;
const TEXT = "50 tacos for the crowd";

beforeEach(async () => {
  chain = new FakeChain();
  store = tempFileStore();
  host = await makeWallet();
  vendor = await makeWallet();
  other = await makeWallet();
  pda = (await makeWallet()).address;
  process.env.JWT_SECRET = "test-secret";
  chain.events.set(pda, sampleOnChainEvent({ host: host.address }));
  setStore(store);
  setChain(chain);
});
afterEach(() => {
  setStore(undefined);
  setChain(undefined);
});

async function propose(text = TEXT, amount = 5_000_000n) {
  chain.sponsorships.push({
    event: pda,
    vendor: vendor.address,
    amount,
    status: "proposed",
    offerHash: await offerHashHex(text),
  });
}

describe("offerHashHex", () => {
  it("is sha256 of canonical {text} JSON (stable vector)", async () => {
    expect(await offerHashHex("hi")).toBe(
      "e7b995efa755c5ff3b84d2188b58cb4ae916a59470eb3761df8a814f11763500"
    );
    expect(await offerHashHex("hi")).toMatch(/^[0-9a-f]{64}$/);
    expect(await offerHashHex("hi")).not.toBe(await offerHashHex("hi "));
  });
});

describe("upsertVendorProfile", () => {
  it("requires an on-chain VendorProfile (400)", async () => {
    await expect(
      upsertVendorProfile(
        { wallet: vendor.address },
        { name: "Taco" },
        { store, chain }
      )
    ).rejects.toMatchObject({ status: 400 });
    expect(await store.getVendor(vendor.address)).toBeNull();
  });

  it("stores and updates the profile; returns the on-chain key", async () => {
    chain.vendors.set(vendor.address, {
      authority: vendor.address,
      vendorKey: "KeyKeyKey",
    });
    const a = await upsertVendorProfile(
      { wallet: vendor.address },
      { name: " Taco ", description: "tasty", logoUrl: "https://x.io/l.png" },
      { store, chain }
    );
    expect(a).toMatchObject({ name: "Taco", vendorKey: "KeyKeyKey" });
    await upsertVendorProfile(
      { wallet: vendor.address },
      { name: "Taco 2" },
      { store, chain }
    );
    expect((await store.getVendor(vendor.address))?.name).toBe("Taco 2");
    expect(
      (await getVendorView(vendor.address, { store, chain })).logoUrl
    ).toBeNull();
  });

  it("validates input", async () => {
    chain.vendors.set(vendor.address, {
      authority: vendor.address,
      vendorKey: "k",
    });
    const call = (b: Record<string, unknown>) =>
      upsertVendorProfile({ wallet: vendor.address }, b, { store, chain });
    await expect(call({})).rejects.toMatchObject({ status: 400 });
    await expect(
      call({ name: "x", logoUrl: "javascript:alert(1)" })
    ).rejects.toMatchObject({ status: 400 });
    await expect(call({ name: "x".repeat(101) })).rejects.toMatchObject({
      status: 400,
    });
    chain.failRpc = true;
    await expect(call({ name: "x" })).rejects.toMatchObject({ status: 502 });
  });

  it("getVendorView: 404 unknown, 400 bad address", async () => {
    await expect(
      getVendorView(vendor.address, { store, chain })
    ).rejects.toMatchObject({ status: 404 });
    await expect(getVendorView("nope", { store, chain })).rejects.toMatchObject(
      { status: 400 }
    );
  });
});

describe("putOffer", () => {
  it("rejects when nothing was proposed on chain (404)", async () => {
    await expect(
      putOffer(
        pda,
        { wallet: vendor.address },
        { text: TEXT },
        { store, chain }
      )
    ).rejects.toMatchObject({ status: 404 });
  });

  it("rejects text that does not match the on-chain offer_hash (400)", async () => {
    await propose();
    await expect(
      putOffer(
        pda,
        { wallet: vendor.address },
        { text: "different" },
        { store, chain }
      )
    ).rejects.toMatchObject({ status: 400 });
    expect(await store.getOffer(pda, vendor.address)).toBeNull();
  });

  it("only the proposing vendor can post (other wallet 404)", async () => {
    await propose();
    await expect(
      putOffer(pda, { wallet: other.address }, { text: TEXT }, { store, chain })
    ).rejects.toMatchObject({ status: 404 });
  });

  it("stores a matching offer; reposting replaces it", async () => {
    await propose();
    const view = await putOffer(
      pda,
      { wallet: vendor.address },
      { text: TEXT },
      { store, chain }
    );
    expect(view).toMatchObject({
      amount: "5000000",
      status: "proposed",
      offerVerified: true,
      offerText: TEXT,
    });
    await putOffer(
      pda,
      { wallet: vendor.address },
      { text: TEXT },
      { store, chain }
    );
    expect(await store.listOffers(pda)).toHaveLength(1);
  });
});

describe("listOffers", () => {
  it("host sees all sponsorships merged with offers and profiles", async () => {
    await propose();
    chain.sponsorships.push({
      event: pda,
      vendor: other.address,
      amount: 1n,
      status: "approved",
      offerHash: "00".repeat(32),
    });
    chain.vendors.set(vendor.address, {
      authority: vendor.address,
      vendorKey: "k",
    });
    await upsertVendorProfile(
      { wallet: vendor.address },
      { name: "Taco" },
      { store, chain }
    );
    await putOffer(
      pda,
      { wallet: vendor.address },
      { text: TEXT },
      { store, chain }
    );

    const offers = await listOffers(
      pda,
      { wallet: host.address },
      { store, chain }
    );
    expect(offers).toHaveLength(2);
    const mine = offers.find((o) => o.vendor === vendor.address)!;
    expect(mine).toMatchObject({
      offerText: TEXT,
      offerVerified: true,
      vendorProfile: { name: "Taco" },
    });
    const noText = offers.find((o) => o.vendor === other.address)!;
    expect(noText).toMatchObject({
      offerText: null,
      offerVerified: false,
      status: "approved",
      vendorProfile: null,
    });
  });

  it("a vendor sees only its own; a stranger gets 403; unknown event 404", async () => {
    await propose();
    chain.sponsorships.push({
      event: pda,
      vendor: other.address,
      amount: 1n,
      status: "proposed",
      offerHash: "00".repeat(32),
    });
    const seen = await listOffers(
      pda,
      { wallet: vendor.address },
      { store, chain }
    );
    expect(seen.map((o) => o.vendor)).toEqual([vendor.address]);
    const stranger = await makeWallet();
    await expect(
      listOffers(pda, { wallet: stranger.address }, { store, chain })
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      listOffers(
        (await makeWallet()).address,
        { wallet: host.address },
        { store, chain }
      )
    ).rejects.toMatchObject({ status: 404 });
    chain.failRpc = true;
    await expect(
      listOffers(pda, { wallet: host.address }, { store, chain })
    ).rejects.toMatchObject({ status: 502 });
  });
});

describe("route handlers", () => {
  const req = (url: string, init: RequestInit = {}, token?: string) =>
    new Request(`http://x${url}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });

  it("vendor flow end to end with JWTs", async () => {
    const params = { params: Promise.resolve({ pda }) };
    const vtoken = await signToken(vendor.address);
    const htoken = await signToken(host.address);
    chain.vendors.set(vendor.address, {
      authority: vendor.address,
      vendorKey: "vk",
    });

    const postVendor = (token?: string) =>
      postVendorRoute(
        req(
          "/api/vendors",
          { method: "POST", body: JSON.stringify({ name: "Taco" }) },
          token
        )
      );
    expect((await postVendor()).status).toBe(401);
    expect((await postVendor(vtoken)).status).toBe(200);
    const got = await getVendorRoute(req(`/api/vendors/${vendor.address}`), {
      params: Promise.resolve({ wallet: vendor.address }),
    });
    expect((await got.json()).vendorKey).toBe("vk");

    await propose();
    const post = (token?: string) =>
      postOfferRoute(
        req(
          `/api/events/${pda}/offers`,
          { method: "POST", body: JSON.stringify({ text: TEXT }) },
          token
        ),
        params
      );
    expect((await post()).status).toBe(401);
    expect((await post(vtoken)).status).toBe(201);

    const list = (token?: string) =>
      getOffersRoute(req(`/api/events/${pda}/offers`, {}, token), params);
    expect((await list()).status).toBe(401);
    expect(
      (await list(await signToken((await makeWallet()).address))).status
    ).toBe(403);
    const body = await (await list(htoken)).json();
    expect(body.offers[0]).toMatchObject({
      vendor: vendor.address,
      offerText: TEXT,
    });
  });
});
