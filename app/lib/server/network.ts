import type { AuthContext } from "./auth";
import { refreshAttendanceThrottled, type AttendanceDeps } from "./attendance";
import { getChain } from "./chain";
import { ApiError } from "./errors";
import { getStore, type StoredEvent } from "./store";

/** eventPda -> wallet -> checkedIn (a Ticket exists; hosts are added as checked in). */
type Holders = Map<string, Map<string, boolean>>;

export interface SharedEvent {
  eventPda: string;
  title: string | null;
  strong: boolean;
}

export interface Peer {
  wallet: string;
  strong: boolean;
  sharedEvents: SharedEvent[];
}

export interface Graph {
  holders: Holders;
  /** Peers of `wallet` (1 hop). `strongOnly` keeps only strong ties. */
  peersOf(wallet: string, strongOnly?: boolean): Map<string, Peer>;
}

/**
 * Build the tie graph from the attendance index plus stored events. Hosts count as
 * holders of their own events, and as checked in (so a host is strongly tied to every
 * attendee who checked in).
 */
export function buildGraph(
  attendance: { eventPda: string; wallet: string; checkedIn: boolean }[],
  events: StoredEvent[]
): Graph {
  const holders: Holders = new Map();
  const add = (event: string, wallet: string, checkedIn: boolean) => {
    let m = holders.get(event);
    if (!m) holders.set(event, (m = new Map()));
    m.set(wallet, (m.get(wallet) ?? false) || checkedIn);
  };
  for (const a of attendance) add(a.eventPda, a.wallet, a.checkedIn);
  for (const e of events) add(e.eventPda, e.hostWallet, true);
  const titles = new Map(events.map((e) => [e.eventPda, e.title]));

  const byWallet = new Map<string, string[]>();
  for (const [event, m] of holders) {
    for (const w of m.keys()) {
      const list = byWallet.get(w);
      if (list) list.push(event);
      else byWallet.set(w, [event]);
    }
  }

  return {
    holders,
    peersOf(wallet, strongOnly = false) {
      const peers = new Map<string, Peer>();
      for (const event of byWallet.get(wallet) ?? []) {
        const m = holders.get(event)!;
        const mine = m.get(wallet)!;
        for (const [peer, theirs] of m) {
          if (peer === wallet) continue;
          const strong = mine && theirs;
          if (strongOnly && !strong) continue;
          let p = peers.get(peer);
          if (!p) {
            peers.set(
              peer,
              (p = { wallet: peer, strong: false, sharedEvents: [] })
            );
          }
          p.strong ||= strong;
          p.sharedEvents.push({
            eventPda: event,
            title: titles.get(event) ?? null,
            strong,
          });
        }
      }
      return peers;
    },
  };
}

async function loadGraph(deps: AttendanceDeps) {
  const store = deps.store ?? getStore();
  await refreshAttendanceThrottled(deps);
  const [attendance, events] = await Promise.all([
    store.listAttendance(),
    store.listEvents(),
  ]);
  return { graph: buildGraph(attendance, events), events, attendance };
}

/** The shared event that connects a viewer to a host (strong preferred, then first). */
function connectingEvent(peer: Peer): SharedEvent {
  return peer.sharedEvents.find((e) => e.strong) ?? peer.sharedEvents[0];
}

export interface FeedEntry {
  event: StoredEvent;
  /** The shared event linking the viewer to the host; null for own or unconnected hosts. */
  via: SharedEvent | null;
}

/**
 * Events visible to `viewer`: public events, the viewer's own events, and `network`
 * events whose host is within 1 hop (strong ties only with `strong`). Public events
 * are always visible, also with `strong`. Newest first.
 */
export async function visibleEvents(
  viewer: AuthContext | null,
  opts: { strong?: boolean } = {},
  deps: AttendanceDeps = {}
): Promise<FeedEntry[]> {
  if (!viewer) {
    const events = await (deps.store ?? getStore()).listEvents();
    return events
      .filter((e) => e.visibility === "public")
      .map((event) => ({ event, via: null }));
  }
  const { graph, events } = await loadGraph(deps);
  const peers = graph.peersOf(viewer.wallet, opts.strong);
  const out: FeedEntry[] = [];
  for (const event of events) {
    const own = event.hostWallet === viewer.wallet;
    const peer = peers.get(event.hostWallet);
    if (event.visibility === "network" && !own && !peer) continue;
    out.push({ event, via: !own && peer ? connectingEvent(peer) : null });
  }
  return out;
}

/** Can `viewer` see this stored event? (public, own, or host within 1 hop). */
export async function canViewEvent(
  stored: StoredEvent,
  viewer: AuthContext | null,
  deps: AttendanceDeps = {}
): Promise<boolean> {
  if (stored.visibility === "public") return true;
  if (!viewer) return false;
  if (stored.hostWallet === viewer.wallet) return true;
  const { graph } = await loadGraph(deps);
  return graph.peersOf(viewer.wallet).has(stored.hostWallet);
}

export interface NetworkSummary {
  wallet: string;
  peers: {
    wallet: string;
    strong: boolean;
    sharedCount: number;
    sharedEvents: SharedEvent[];
  }[];
  totals: {
    connections: number;
    strong: number;
    weak: number;
    /** Events the viewer holds a ticket for (hosting does not count). */
    eventsAttended: number;
    /** ... of which the viewer checked in. */
    checkedIn: number;
  };
  /** `network` events hosted by someone outside the viewer's 1-hop circle. */
  unlockable: number;
  /**
   * The single event whose attendance would unlock the most hidden network events,
   * or null when nothing would unlock.
   */
  nextUnlock: { eventPda: string; title: string; unlocks: number } | null;
}

/** GET /api/me/network. */
export async function getNetwork(
  viewer: AuthContext,
  deps: AttendanceDeps = {}
): Promise<NetworkSummary> {
  const { graph, events, attendance } = await loadGraph(deps);
  const peerMap = graph.peersOf(viewer.wallet);
  const peers = [...peerMap.values()]
    .map((p) => ({
      wallet: p.wallet,
      strong: p.strong,
      sharedCount: p.sharedEvents.length,
      sharedEvents: p.sharedEvents,
    }))
    .sort(
      (a, b) =>
        Number(b.strong) - Number(a.strong) ||
        b.sharedCount - a.sharedCount ||
        a.wallet.localeCompare(b.wallet)
    );
  const strong = peers.filter((p) => p.strong).length;
  const mine = attendance.filter((a) => a.wallet === viewer.wallet);

  const hidden = events.filter(
    (e) =>
      e.visibility === "network" &&
      e.hostWallet !== viewer.wallet &&
      !peerMap.has(e.hostWallet)
  );
  const hiddenHosts = new Map<string, number>();
  for (const e of hidden) {
    hiddenHosts.set(e.hostWallet, (hiddenHosts.get(e.hostWallet) ?? 0) + 1);
  }

  // Candidate events to attend: visible to the viewer, not already held, still open.
  let nextUnlock: NetworkSummary["nextUnlock"] = null;
  if (hidden.length > 0) {
    const candidates = events.filter(
      (e) =>
        e.hostWallet !== viewer.wallet &&
        !graph.holders.get(e.eventPda)?.has(viewer.wallet) &&
        (e.visibility === "public" || peerMap.has(e.hostWallet))
    );
    let open: Set<string> | null = null;
    try {
      const chain = deps.chain ?? getChain();
      const now = Math.floor((deps.now ?? Date.now)() / 1000);
      const onchain = await chain.getEvents(candidates.map((e) => e.eventPda));
      open = new Set(
        candidates
          .filter((_, i) => {
            const c = onchain[i];
            return c && c.status === "open" && c.endTs > now;
          })
          .map((e) => e.eventPda)
      );
    } catch (err) {
      console.error("RPC error reading candidate events", err);
    }
    for (const e of candidates) {
      if (open && !open.has(e.eventPda)) continue;
      let unlocks = 0;
      for (const w of graph.holders.get(e.eventPda)?.keys() ?? []) {
        unlocks += hiddenHosts.get(w) ?? 0;
      }
      if (unlocks > (nextUnlock?.unlocks ?? 0)) {
        nextUnlock = { eventPda: e.eventPda, title: e.title, unlocks };
      }
    }
  }

  return {
    wallet: viewer.wallet,
    peers,
    totals: {
      connections: peers.length,
      strong,
      weak: peers.length - strong,
      eventsAttended: mine.length,
      checkedIn: mine.filter((a) => a.checkedIn).length,
    },
    unlockable: hidden.length,
    nextUnlock,
  };
}

/** Bearer check for cron-style endpoints; 503 when CRON_SECRET is unset. */
export function requireCronSecret(
  request: Request,
  secret = process.env.CRON_SECRET
): void {
  if (!secret) throw new ApiError(503, "CRON_SECRET is not configured");
  const h = request.headers.get("authorization") ?? "";
  const given = /^Bearer\s+(.+)$/i.exec(h)?.[1] ?? "";
  let diff = given.length ^ secret.length;
  for (let i = 0; i < secret.length; i++) {
    diff |= (given.charCodeAt(i) || 0) ^ secret.charCodeAt(i);
  }
  if (diff !== 0) throw new ApiError(401, "Invalid cron secret");
}
