import { getChain, type Chain } from "./chain";
import { getStore, type AttendanceRow, type Store } from "./store";

/** Minimum time between on-demand indexer runs (per process). */
export const REFRESH_THROTTLE_MS = 30_000;

export interface AttendanceDeps {
  store?: Store;
  chain?: Chain;
  now?: () => number; // unix ms
  /** Throttle state; defaults to a process-wide one. Tests pass their own. */
  throttle?: ThrottleState;
}

export interface ThrottleState {
  lastRunAt: number | null;
  inflight: Promise<RefreshResult> | null;
}

export interface RefreshResult {
  /** Ticket accounts read from the chain and upserted. */
  indexed: number;
}

const processThrottle: ThrottleState = { lastRunAt: null, inflight: null };

/**
 * Read every `Ticket` account via `getProgramAccounts` and upsert
 * `attendance(event_pda, wallet, checked_in, checked_in_at)`.
 *
 * Rows are never deleted: a refunded (closed) ticket stays in the index until the
 * table is rebuilt. Refunds only exist for cancelled events, so the effect is a
 * slightly stale tie, not a wrong unlock.
 */
export async function refreshAttendance(
  deps: AttendanceDeps = {}
): Promise<RefreshResult> {
  const store = deps.store ?? getStore();
  const chain = deps.chain ?? getChain();
  const tickets = await chain.listTickets();
  const rows: AttendanceRow[] = tickets.map((t) => ({
    eventPda: t.eventPda,
    wallet: t.member,
    checkedIn: t.checkedIn,
    checkedInAt:
      t.checkedIn && t.checkedInAt > 0
        ? new Date(t.checkedInAt * 1000).toISOString()
        : null,
  }));
  await store.upsertAttendance(rows);
  return { indexed: rows.length };
}

/**
 * Run `refreshAttendance` unless it ran within the last 30 s (success only).
 * Concurrent callers share one in-flight run. Returns whether a run happened;
 * indexer failures are logged and swallowed so reads fall back to the stored index.
 */
export async function refreshAttendanceThrottled(
  deps: AttendanceDeps = {}
): Promise<boolean> {
  const state = deps.throttle ?? processThrottle;
  const now = (deps.now ?? Date.now)();
  if (state.inflight) {
    await state.inflight.catch(() => undefined);
    return false;
  }
  if (state.lastRunAt !== null && now - state.lastRunAt < REFRESH_THROTTLE_MS) {
    return false;
  }
  const run = refreshAttendance(deps);
  state.inflight = run;
  try {
    await run;
    state.lastRunAt = now;
    return true;
  } catch (err) {
    console.error("Attendance refresh failed", err);
    return false;
  } finally {
    state.inflight = null;
  }
}
