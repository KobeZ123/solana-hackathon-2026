"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { toast } from "sonner";
import type { Address } from "@solana/kit";
import { getJoinEventInstruction } from "../../generated/event_pool";
import { useCluster } from "../../components/cluster-context";
import { useWallet } from "../../lib/wallet/context";
import { useBalance } from "../../lib/hooks/use-balance";
import { useSendTransaction } from "../../lib/hooks/use-send-transaction";
import { parseTransactionError } from "../../lib/errors";
import { ellipsify } from "../../lib/explorer";
import { generateTicketKey, saveTicketKey } from "../../lib/qr";
import {
  deriveVaultAddress,
  eventPhase,
  eventStatusLabel,
  formatSol,
  formatTimestamp,
  joinBlocker,
  useEvent,
  useEventSummary,
  usePoolBalance,
  useTicket,
} from "../../lib/event-pool";
import { EventDetails } from "./event-details";

/** Ticket account rent + a little for fees, on top of the entry fee. */
const JOIN_OVERHEAD_LAMPORTS = 3_000_000n;

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border-low bg-card p-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold">{value}</dd>
    </div>
  );
}

const primaryBtn =
  "flex h-12 w-full items-center justify-center rounded-xl bg-primary text-sm font-medium text-primary-foreground disabled:opacity-60";
const secondaryBtn =
  "flex h-12 items-center justify-center rounded-xl border border-border bg-card px-4 text-sm font-medium transition hover:bg-cream";

export function EventView({ pda }: { pda: string }) {
  const { cluster, getExplorerUrl } = useCluster();
  const { wallet, signer, status } = useWallet();
  const member = wallet?.account.address;

  const { event, isLoading, error, mutate: mutateEvent } = useEvent(pda);
  const { summary } = useEventSummary(pda);
  const { pool, mutate: mutatePool } = usePoolBalance(pda);
  const {
    ticket,
    ticketAddress,
    mutate: mutateTicket,
  } = useTicket(pda, member);
  const { lamports: balance } = useBalance(member);
  const { send } = useSendTransaction();

  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [keyWarning, setKeyWarning] = useState(false);
  const busy = useRef(false);

  if (isLoading || event === undefined) {
    if (error) {
      return (
        <p role="alert" className="text-sm text-destructive">
          Could not read the event from {cluster}: {error.message}
        </p>
      );
    }
    return (
      <div className="space-y-3" aria-hidden>
        <div className="h-8 w-2/3 animate-pulse rounded bg-card" />
        <div className="h-32 animate-pulse rounded-2xl bg-card" />
      </div>
    );
  }

  if (event === null) {
    return (
      <div className="rounded-2xl border border-border-low bg-card p-6">
        <h1 className="text-lg font-semibold">Event not found</h1>
        <p className="mt-1 text-sm text-foreground/60">
          There is no event at this address on {cluster}. If you expected one,
          switch the cluster in the header.
        </p>
      </div>
    );
  }

  const isHost = member !== undefined && member === event.host;
  const hasTicket = ticket !== null && ticket !== undefined;
  const blocker = joinBlocker(event);
  const phase = eventPhase(event);
  const needed = event.entryFee + JOIN_OVERHEAD_LAMPORTS;
  const insufficient = balance !== null && balance < needed;
  const title = summary?.title ?? "Event";

  const join = async () => {
    if (busy.current || !signer || !member || !ticketAddress) return;
    busy.current = true;
    setJoining(true);
    setJoinError(null);
    try {
      const key = generateTicketKey();
      const vault = await deriveVaultAddress(pda as Address);
      const signature = await send({
        instructions: [
          getJoinEventInstruction({
            member: signer,
            event: pda as Address,
            vault,
            ticket: ticketAddress,
            ticketKey: key.publicKey as Address,
          }),
        ],
      });
      // The secret only ever lives in this browser: persist it right away.
      const saved = saveTicketKey(pda, member, key);
      setKeyWarning(!saved);
      toast.success("You joined this event", {
        action: {
          label: "Explorer",
          onClick: () =>
            window.open(getExplorerUrl(`/tx/${signature}`), "_blank"),
        },
      });
      await Promise.all([mutateTicket(), mutateEvent(), mutatePool()]);
    } catch (err) {
      setJoinError(parseTransactionError(err));
    } finally {
      busy.current = false;
      setJoining(false);
    }
  };

  let action: React.ReactNode;
  if (status === "connecting") {
    action = <p className="text-sm text-muted">Connecting wallet...</p>;
  } else if (!wallet) {
    action = (
      <p className="rounded-xl border border-border-low bg-card p-4 text-sm text-foreground/60">
        Connect a wallet (top right) to join this event.
      </p>
    );
  } else if (isHost) {
    action = (
      <div className="grid grid-cols-2 gap-2">
        <Link href={`/events/${pda}/host`} className={secondaryBtn}>
          Host dashboard
        </Link>
        <Link href={`/events/${pda}/scan`} className={secondaryBtn}>
          Scanner
        </Link>
      </div>
    );
  } else if (hasTicket) {
    action = (
      <div className="grid grid-cols-2 gap-2">
        <Link href={`/events/${pda}/ticket`} className={primaryBtn}>
          View ticket
        </Link>
        <Link href={`/events/${pda}/claim`} className={secondaryBtn}>
          Claim / refund
        </Link>
      </div>
    );
  } else if (blocker === "sold_out") {
    action = <p className="text-sm font-medium">Sold out</p>;
  } else if (blocker === "cancelled") {
    action = <p className="text-sm font-medium">This event was cancelled.</p>;
  } else if (blocker === "ended") {
    action = <p className="text-sm font-medium">This event has ended.</p>;
  } else {
    action = (
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => void join()}
          disabled={joining || ticket === undefined || insufficient}
          className={primaryBtn}
        >
          {joining
            ? "Confirm in your wallet..."
            : `Join for ${formatSol(event.entryFee)} SOL`}
        </button>
        {insufficient && (
          <p className="text-xs text-muted">
            You need about {formatSol(needed)} SOL (fee plus ticket rent) and
            have {formatSol(balance ?? 0n)}.{" "}
            {cluster === "devnet" && (
              <>
                Get free devnet SOL at{" "}
                <a
                  className="underline"
                  href="https://faucet.solana.com"
                  target="_blank"
                  rel="noreferrer"
                >
                  faucet.solana.com
                </a>
                .
              </>
            )}
          </p>
        )}
        {joinError && (
          <p role="alert" className="text-sm text-destructive">
            {joinError}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-xl space-y-5">
      {summary?.coverUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={summary.coverUrl}
          alt=""
          className="aspect-[2/1] w-full rounded-2xl object-cover"
        />
      )}
      <div>
        <div className="flex items-center gap-2 text-xs text-muted">
          <span className="rounded-full border border-border px-2 py-0.5">
            {eventStatusLabel(event.status)}
          </span>
          <span>
            {phase === "upcoming"
              ? "Upcoming"
              : phase === "live"
                ? "Happening now"
                : "Over"}
          </span>
        </div>
        <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
          {title}
        </h1>
        {summary?.summary && (
          <p className="mt-2 text-sm leading-relaxed text-foreground/60">
            {summary.summary}
          </p>
        )}
        {summary === null && (
          <p className="mt-2 text-xs text-muted">
            No title or description is registered for this event.
          </p>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-2">
        <Stat label="Entry fee" value={`${formatSol(event.entryFee)} SOL`} />
        <Stat
          label="Tickets"
          value={`${event.ticketsSold} / ${event.capacity}`}
        />
        <Stat label="Starts" value={formatTimestamp(event.startTs)} />
        <Stat label="Ends" value={formatTimestamp(event.endTs)} />
        <Stat
          label="Pool"
          value={pool === undefined ? "..." : `${formatSol(pool, 4)} SOL`}
        />
        <Stat label="Checked in" value={String(event.checkedIn)} />
        <Stat
          label="Attendee payout"
          value={`${event.payoutBps / 100}% of pool`}
        />
        <Stat label="Host" value={ellipsify(event.host)} />
      </dl>

      {action}

      {keyWarning && (
        <p
          role="alert"
          className="rounded-xl border border-destructive p-3 text-sm text-destructive"
        >
          Your browser blocked storage, so your ticket secret could not be
          saved. Your ticket exists on-chain, but you will need to use Recover
          ticket on the ticket page to get a working QR. Screenshot this page
          now.
        </p>
      )}

      {member && (isHost || hasTicket) && (
        <EventDetails pda={pda} wallet={member} />
      )}
      {!isHost && !hasTicket && (
        <p className="text-xs text-muted">
          Location and details unlock after you join.
        </p>
      )}
    </div>
  );
}
