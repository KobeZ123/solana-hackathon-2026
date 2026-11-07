import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as feedRoute } from "../../api/feed/route";
import { GET as getEventRoute } from "../../api/events/[pda]/route";
import { POST as refreshRoute } from "../../api/index/refresh/route";
import { GET as networkRoute } from "../../api/me/network/route";
import {
  REFRESH_THROTTLE_MS,
  refreshAttendance,
  refreshAttendanceThrottled,
  type AttendanceDeps,
  type ThrottleState,
} from "./attendance";
import { signToken } from "./auth";
import { setChain } from "./chain";
import { FakeChain, sampleOnChainEvent } from "./chain-testing";
import { listEvents, getEventSummary } from "./events";
import { ApiError } from "./errors";
import { getNetwork } from "./network";
import { setStore, type StoredEvent, type Visibility } from "./store";
import { makeWallet, tempFileStore } from "./testing";

let chain: FakeChain;
let store: ReturnType<typeof tempFileStore>;
let deps: AttendanceDeps;
let t = 1_700_000_000_000;

async function addr() {
  return (await makeWallet()).address;
}

async function addEvent(
  host: string,
  visibility: Visibility,
  title = "Event",
  open = true
) {
  const eventPda = await addr();
  const e: StoredEvent = {
    eventPda,
    hostWallet: host,
    title,
    summary: "",
    coverUrl: null,
    details: {},
    metadataHash: "00".repeat(32),
    visibility,
    createdAt: new Date(t++).toISOString(),
  };
  await store.insertEvent(e);
  chain.events.set(
    eventPda,
    sampleOnChainEvent({
      host,
      status: open ? "open" : "ended",
      endTs: Math.floor(Date.now() / 1000) + 3600,
    })
  );
  return eventPda;
}

const as = (wallet: string) => ({ wallet });
const pdas = (events: { eventPda: string }[]) => events.map((e) => e.eventPda);

beforeEach(() => {
  chain = new FakeChain();
  store = tempFileStore();
  deps = {
    store,
    chain,
    throttle: { lastRunAt: null, inflight: null },
  };
  process.env.JWT_SECRET = "test-secret";
  setStore(store);
  setChain(chain);
});

afterEach(() => {
  setStore(undefined);
  setChain(undefined);
  delete process.env.CRON_SECRET;
});

describe("indexer", () => {
  it("upserts tickets with check-in state", async () => {
    const [a, b] = [await addr(), await addr()];
    const e = await addr();
    chain.addTicket(e, a, true);
    chain.addTicket(e, b, false);
    expect(await refreshAttendance(deps)).toEqual({ indexed: 2 });
    const rows = await store.listAttendance();
    expect(rows).toHaveLength(2);
    const ra = rows.find((r) => r.wallet === a)!;
    expect(ra.checkedIn).toBe(true);
    expect(ra.checkedInAt).toMatch(/^\d{4}-/);
    expect(rows.find((r) => r.wallet === b)!.checkedInAt).toBeNull();
  });

  it("throttles on-demand runs to one per 30 s and retries after failure", async () => {
    const state: ThrottleState = { lastRunAt: null, inflight: null };
    let now = 1000;
    const d = { ...deps, throttle: state, now: () => now };
    expect(await refreshAttendanceThrottled(d)).toBe(true);
    expect(await refreshAttendanceThrottled(d)).toBe(false);
    now += REFRESH_THROTTLE_MS - 1;
    expect(await refreshAttendanceThrottled(d)).toBe(false);
    expect(chain.listTicketsCalls).toBe(1);
    now += 1;
    expect(await refreshAttendanceThrottled(d)).toBe(true);
    expect(chain.listTicketsCalls).toBe(2);

    // a failed run is swallowed and does not start the throttle window
    chain.failRpc = true;
    now += REFRESH_THROTTLE_MS;
    expect(await refreshAttendanceThrottled(d)).toBe(false);
    chain.failRpc = false;
    expect(await refreshAttendanceThrottled(d)).toBe(true);
  });

  it("concurrent callers share one run", async () => {
    const d = { ...deps, now: () => 5 };
    await Promise.all([
      refreshAttendanceThrottled(d),
      refreshAttendanceThrottled(d),
      refreshAttendanceThrottled(d),
    ]);
    expect(chain.listTicketsCalls).toBe(1);
  });
});

describe("ties and visibility", () => {
  it("weak tie: both hold tickets, neither checked in", async () => {
    const [h, v, p] = [await addr(), await addr(), await addr()];
    const shared = await addEvent(h, "public", "Shared");
    chain.addTicket(shared, v);
    chain.addTicket(shared, p);
    const net = await getNetwork(as(v), deps);
    const peer = net.peers.find((x) => x.wallet === p)!;
    expect(peer.strong).toBe(false);
    expect(peer.sharedEvents.map((s) => s.eventPda)).toEqual([shared]);
    // the host counts as checked in, but v is not, so both ties are weak
    expect(net.totals).toMatchObject({ connections: 2, strong: 0, weak: 2 });
    expect(net.peers.find((x) => x.wallet === h)!.strong).toBe(false);
  });

  it("strong tie: both checked in; host counts as checked in", async () => {
    const [h, v, p] = [await addr(), await addr(), await addr()];
    const shared = await addEvent(h, "public");
    chain.addTicket(shared, v, true);
    chain.addTicket(shared, p, true);
    const net = await getNetwork(as(v), deps);
    expect(net.peers.map((x) => [x.wallet, x.strong]).sort()).toEqual(
      [
        [h, true],
        [p, true],
      ].sort()
    );
    expect(net.totals).toMatchObject({
      eventsAttended: 1,
      checkedIn: 1,
      strong: 2,
      weak: 0,
    });
  });

  it("network event visible via a weak tie (shared attendance), hidden otherwise", async () => {
    const [h, v, stranger] = [await addr(), await addr(), await addr()];
    const hosted = await addEvent(h, "network", "Secret");
    const common = await addEvent(await addr(), "public", "Common");
    expect(pdas(await listEvents(as(v), deps))).not.toContain(hosted);

    chain.addTicket(common, v);
    chain.addTicket(common, h);
    deps.throttle = { lastRunAt: null, inflight: null };
    const feed = await listEvents(as(v), deps);
    const entry = feed.find((e) => e.eventPda === hosted)!;
    expect(entry.via).toEqual({
      eventPda: common,
      title: "Common",
      strong: false,
    });
    expect(pdas(await listEvents(as(stranger), deps))).not.toContain(hosted);
  });

  it("host counted as holder: attending the host's own event connects you", async () => {
    const [h, v] = [await addr(), await addr()];
    const other = await addEvent(h, "network", "Other");
    const own = await addEvent(h, "public", "Own");
    expect(pdas(await listEvents(as(v), deps))).not.toContain(other);
    chain.addTicket(own, v); // no check-in needed for a weak tie
    deps.throttle = { lastRunAt: null, inflight: null };
    expect(pdas(await listEvents(as(v), deps))).toContain(other);
  });

  it("strong=1 requires both checked in; public stays visible", async () => {
    const [h, v] = [await addr(), await addr()];
    const hosted = await addEvent(h, "network");
    const pub = await addEvent(await addr(), "public");
    const common = await addEvent(h, "public", "Common");
    chain.addTicket(common, v, false);
    expect(pdas(await listEvents(as(v), deps, { strong: true }))).toEqual(
      expect.arrayContaining([pub])
    );
    expect(pdas(await listEvents(as(v), deps, { strong: true }))).not.toContain(
      hosted
    );
    chain.addTicket(common, v, true);
    deps.throttle = { lastRunAt: null, inflight: null };
    const strongFeed = await listEvents(as(v), deps, { strong: true });
    expect(pdas(strongFeed)).toContain(hosted);
    expect(strongFeed.find((e) => e.eventPda === hosted)!.via?.strong).toBe(
      true
    );
  });

  it("is 1 hop only: friend of a friend does not unlock", async () => {
    const [v, friend, fof] = [await addr(), await addr(), await addr()];
    const e1 = await addEvent(await addr(), "public");
    const e2 = await addEvent(await addr(), "public");
    chain.addTicket(e1, v);
    chain.addTicket(e1, friend);
    chain.addTicket(e2, friend);
    chain.addTicket(e2, fof);
    const hosted = await addEvent(fof, "network");
    expect(pdas(await listEvents(as(v), deps))).not.toContain(hosted);
    const friendHosted = await addEvent(friend, "network");
    expect(pdas(await listEvents(as(v), deps))).toContain(friendHosted);
  });

  it("host always sees own network event; anonymous sees public only", async () => {
    const h = await addr();
    const net = await addEvent(h, "network");
    const pub = await addEvent(h, "public");
    expect(pdas(await listEvents(as(h), deps))).toEqual(
      expect.arrayContaining([net, pub])
    );
    expect(pdas(await listEvents(null, deps))).toEqual([pub]);
  });

  it("GET event summary 404s for hidden network events, 200 when connected or host", async () => {
    const [h, v] = [await addr(), await addr()];
    const hosted = await addEvent(h, "network");
    const common = await addEvent(h, "public");
    await expect(getEventSummary(hosted, as(v), deps)).rejects.toMatchObject({
      status: 404,
    });
    await expect(getEventSummary(hosted, null, deps)).rejects.toBeInstanceOf(
      ApiError
    );
    expect((await getEventSummary(hosted, as(h), deps)).eventPda).toBe(hosted);
    chain.addTicket(common, v);
    deps.throttle = { lastRunAt: null, inflight: null };
    expect((await getEventSummary(hosted, as(v), deps)).eventPda).toBe(hosted);
  });
});

describe("network summary", () => {
  it("reports unlockable events and the best next event to attend", async () => {
    const [v, h1, h2] = [await addr(), await addr(), await addr()];
    await addEvent(h1, "network", "H1 a");
    await addEvent(h1, "network", "H1 b");
    await addEvent(h2, "network", "H2 a");
    const gateway = await addEvent(await addr(), "public", "Gateway");
    chain.addTicket(gateway, h1);
    const net = await getNetwork(as(v), deps);
    expect(net.unlockable).toBe(3);
    expect(net.nextUnlock).toEqual({
      eventPda: gateway,
      title: "Gateway",
      unlocks: 2,
    });
    expect(net.peers).toEqual([]);
  });

  it("skips ended events as next-unlock candidates", async () => {
    const [v, h1] = [await addr(), await addr()];
    await addEvent(h1, "network");
    const ended = await addEvent(await addr(), "public", "Over", false);
    chain.addTicket(ended, h1);
    expect((await getNetwork(as(v), deps)).nextUnlock).toBeNull();
  });
});

describe("routes", () => {
  it("POST /api/index/refresh requires the cron secret", async () => {
    const e = await addr();
    chain.addTicket(e, await addr());
    const call = (auth?: string) =>
      refreshRoute(
        new Request("http://x/api/index/refresh", {
          method: "POST",
          headers: auth ? { authorization: auth } : {},
        })
      );
    expect((await call("Bearer s3cret")).status).toBe(503); // unset
    process.env.CRON_SECRET = "s3cret";
    expect((await call()).status).toBe(401);
    expect((await call("Bearer nope")).status).toBe(401);
    const ok = await call("Bearer s3cret");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ indexed: 1 });
  });

  it("GET /api/feed, /api/me/network and /api/events/[pda] honour the viewer", async () => {
    const [h, v] = [await addr(), await addr()];
    const hosted = await addEvent(h, "network");
    const common = await addEvent(h, "public");
    chain.addTicket(common, v, true);
    const token = await signToken(v);
    const headers = { authorization: `Bearer ${token}` };

    const anon = await feedRoute(new Request("http://x/api/feed"));
    expect(pdas((await anon.json()).events)).toEqual([common]);

    const authed = await feedRoute(
      new Request("http://x/api/feed", { headers })
    );
    expect(pdas((await authed.json()).events)).toContain(hosted);

    const net = await networkRoute(
      new Request("http://x/api/me/network", { headers })
    );
    expect((await net.json()).totals.connections).toBe(1);
    const noAuth = await networkRoute(new Request("http://x/api/me/network"));
    expect(noAuth.status).toBe(401);

    const params = (pda: string) => ({ params: Promise.resolve({ pda }) });
    const ok = await getEventRoute(
      new Request("http://x", { headers }),
      params(hosted)
    );
    expect(ok.status).toBe(200);
    const hidden = await getEventRoute(new Request("http://x"), params(hosted));
    expect(hidden.status).toBe(404);
  });
});
