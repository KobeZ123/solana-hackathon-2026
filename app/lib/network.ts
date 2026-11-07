/** Client-side types and parsing for `GET /api/me/network`. */

export type SharedEventInfo = {
  eventPda: string;
  title: string | null;
  strong: boolean;
};

export type NetworkPeer = {
  wallet: string;
  strong: boolean;
  sharedCount: number;
  sharedEvents: SharedEventInfo[];
};

export type NetworkData = {
  peers: NetworkPeer[];
  totals: {
    connections: number;
    strong: number;
    weak: number;
    eventsAttended: number;
    checkedIn: number;
  };
  unlockable: number;
  nextUnlock: { eventPda: string; title: string; unlocks: number } | null;
};

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};
const nat = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;

export function parseSharedEvent(v: unknown): SharedEventInfo | null {
  const o = obj(v);
  if (typeof o.eventPda !== "string" || o.eventPda === "") return null;
  return {
    eventPda: o.eventPda,
    title: typeof o.title === "string" && o.title !== "" ? o.title : null,
    strong: o.strong === true,
  };
}

export function parseNetwork(body: unknown): NetworkData {
  const o = obj(body);
  const peers: NetworkPeer[] = [];
  for (const raw of Array.isArray(o.peers) ? o.peers : []) {
    const p = obj(raw);
    if (typeof p.wallet !== "string") continue;
    const sharedEvents = (Array.isArray(p.sharedEvents) ? p.sharedEvents : [])
      .map(parseSharedEvent)
      .filter((e): e is SharedEventInfo => e !== null);
    peers.push({
      wallet: p.wallet,
      strong: p.strong === true,
      sharedCount: sharedEvents.length,
      sharedEvents,
    });
  }
  const t = obj(o.totals);
  const next = obj(o.nextUnlock);
  const unlocks = nat(next.unlocks);
  return {
    peers,
    totals: {
      connections: nat(t.connections),
      strong: nat(t.strong),
      weak: nat(t.weak),
      eventsAttended: nat(t.eventsAttended),
      checkedIn: nat(t.checkedIn),
    },
    unlockable: nat(o.unlockable),
    nextUnlock:
      typeof next.eventPda === "string" && unlocks > 0
        ? {
            eventPda: next.eventPda,
            title: typeof next.title === "string" ? next.title : "an event",
            unlocks,
          }
        : null,
  };
}

/** "Attend 1 more event to unlock 3 events", or null when there is nothing to unlock. */
export function unlockNudge(n: NetworkData): string | null {
  if (!n.nextUnlock) return null;
  const k = n.nextUnlock.unlocks;
  return `Attend 1 more event to unlock ${k} ${k === 1 ? "event" : "events"}`;
}
