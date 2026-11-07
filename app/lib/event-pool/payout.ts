import { EventStatus } from "../../generated/event_pool";
import { VAULT_RENT_MIN_LAMPORTS } from "./format";

/**
 * Payout math, mirroring `end_event` / `claim` / `withdraw_host` in the program
 * (docs/TICKETS.md). All amounts are lamports as bigint, integer division only.
 */
export type PayoutBreakdown = {
  /** vault lamports minus the rent floor (never negative). */
  pool: bigint;
  /** Split among checked-in attendees (0 when nobody checked in). */
  attendeePool: bigint;
  /** Host share before sponsorship reservations. */
  hostBudget: bigint;
  /** `attendeePool / checkedIn` (0 when nobody checked in). */
  perAttendee: bigint;
  /** Remainder of the attendee split, released to the host. */
  dust: bigint;
  /** Exactly what `withdraw_host` pays: `hostBudget - approvedSponsorTotal + dust`. */
  hostWithdraw: bigint;
};

/** Preview of what `end_event` would snapshot given the current vault balance. */
export function computePayout(args: {
  vaultLamports: bigint;
  payoutBps: number;
  checkedIn: number;
  approvedSponsorTotal?: bigint;
}): PayoutBreakdown {
  const pool =
    args.vaultLamports > VAULT_RENT_MIN_LAMPORTS
      ? args.vaultLamports - VAULT_RENT_MIN_LAMPORTS
      : 0n;
  return breakdown({
    pool,
    attendeePool: (pool * BigInt(args.payoutBps)) / 10_000n,
    checkedIn: args.checkedIn,
    approvedSponsorTotal: args.approvedSponsorTotal ?? 0n,
  });
}

/** Payout from the snapshot stored on an Ended event (`attendee_pool`, `host_budget`). */
export function settledPayout(event: {
  attendeePool: bigint;
  hostBudget: bigint;
  checkedIn: number;
  approvedSponsorTotal: bigint;
}): PayoutBreakdown {
  const perAttendee =
    event.checkedIn > 0 ? event.attendeePool / BigInt(event.checkedIn) : 0n;
  const dust =
    event.checkedIn > 0
      ? event.attendeePool - perAttendee * BigInt(event.checkedIn)
      : 0n;
  return {
    pool: event.attendeePool + event.hostBudget,
    attendeePool: event.attendeePool,
    hostBudget: event.hostBudget,
    perAttendee,
    dust,
    hostWithdraw: event.hostBudget - event.approvedSponsorTotal + dust,
  };
}

function breakdown(a: {
  pool: bigint;
  attendeePool: bigint;
  checkedIn: number;
  approvedSponsorTotal: bigint;
}): PayoutBreakdown {
  let attendeePool = a.attendeePool;
  let hostBudget = a.pool - attendeePool;
  if (a.checkedIn === 0) {
    hostBudget += attendeePool;
    attendeePool = 0n;
  }
  return settledPayout({
    attendeePool,
    hostBudget,
    checkedIn: a.checkedIn,
    approvedSponsorTotal: a.approvedSponsorTotal,
  });
}

export type HostActions = {
  /** Open and before `start_ts`. */
  cancel: boolean;
  /** Open and at/after `end_ts`. */
  end: boolean;
  /** Ended and not yet withdrawn. */
  withdraw: boolean;
};

/** Which irreversible host actions the program would currently accept. */
export function hostActions(
  event: {
    status: EventStatus;
    startTs: bigint;
    endTs: bigint;
    hostWithdrawn: boolean;
  },
  nowSecs: number = Math.floor(Date.now() / 1000)
): HostActions {
  const now = BigInt(nowSecs);
  const open = event.status === EventStatus.Open;
  return {
    cancel: open && now < event.startTs,
    end: open && now >= event.endTs,
    withdraw: event.status === EventStatus.Ended && !event.hostWithdrawn,
  };
}
