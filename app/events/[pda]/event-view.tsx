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
import { EventHero } from "../../components/event-hero";
import {
  ArrowRightIcon,
  CalendarIcon,
  GiftIcon,
  HostIcon,
  LockIcon,
  MapPinIcon,
  PoolIcon,
  TicketIcon,
} from "../../components/icons";
import { generateTicketKey, saveTicketKey } from "../../lib/qr";
import {
  deriveVaultAddress,
  eventPhase,
  fillPercent,
  formatEventWhen,
  eventStatusLabel,
  formatSol,
  joinBlocker,
  useEvent,
  useEventSummary,
  usePoolBalance,
  useTicket,
} from "../../lib/event-pool";
import { EventDetails } from "./event-details";
import { ProposeSponsorship } from "./propose-sponsorship";

/** Ticket account rent + a little for fees, on top of the entry fee. */
const JOIN_OVERHEAD_LAMPORTS = 3_000_000n;

type Tone = "champagne" | "chrome" | "neutral" | "danger";

const toneClass: Record<Tone, string> = {
  champagne: "bg-champagne/15 text-champagne ring-1 ring-champagne/25",
  chrome: "bg-white/10 text-chrome ring-1 ring-white/10",
  neutral: "bg-white/5 text-foreground/55 ring-1 ring-white/10",
  danger: "bg-destructive/15 text-destructive",
};

function Pill({
  tone,
  dot,
  children,
}: {
  tone: Tone;
  dot?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium backdrop-blur ${toneClass[tone]}`}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/** One fact about the event: a quiet icon beside a two-line label (no box per value). */
function Fact({
  icon,
  title,
  sub,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  sub?: string;
  children?: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-3.5">
      <span className="mt-0.5 text-foreground/45">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] leading-snug font-medium">{title}</p>
        {sub && <p className="mt-0.5 text-sm text-foreground/50">{sub}</p>}
        {children}
      </div>
    </li>
  );
}

/** The money, in one quiet strip instead of a grid of cards. */
function MoneyStrip({
  items,
}: {
  items: { icon: React.ReactNode; label: string; value: string }[];
}) {
  return (
    <dl className="grid grid-cols-3 divide-x divide-border-low rounded-2xl bg-elevated/50 ring-1 ring-border-low">
      {items.map((it) => (
        <div key={it.label} className="min-w-0 px-3 py-4 sm:px-5">
          <dt className="flex items-center gap-1.5 text-xs text-muted">
            <span className="text-foreground/40 [&>svg]:size-4">{it.icon}</span>
            {it.label}
          </dt>
          <dd className="mt-1.5 truncate text-[15px] font-semibold">
            {it.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Fully rounded champagne-metal call to action. */
const ctaBtn =
  "group relative flex h-14 w-full items-center justify-center rounded-full bg-gradient-to-b from-[#ecdcb9] via-champagne to-[#b99a64] px-12 text-[15px] font-semibold text-[#17130b] shadow-[inset_0_1px_0_rgba(255,255,255,0.45),0_10px_30px_-12px_rgba(214,185,136,0.55)] transition hover:-translate-y-px hover:brightness-105 disabled:translate-y-0 disabled:opacity-55 disabled:shadow-none";
const ghostBtn =
  "flex h-12 items-center justify-center rounded-full border border-border bg-surface px-5 text-sm font-medium transition hover:-translate-y-px hover:bg-elevated";

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
      <p className="flex items-center gap-2.5 rounded-full border border-border-low bg-elevated/50 px-5 py-3.5 text-sm text-foreground/70">
        <LockIcon className="size-4 shrink-0 text-champagne" />
        Connect a wallet to join this event.
      </p>
    );
  } else if (isHost) {
    action = (
      <div className="grid grid-cols-2 gap-2">
        <Link href={`/events/${pda}/host`} className={ctaBtn}>
          Host dashboard
        </Link>
        <Link href={`/events/${pda}/scan`} className={ghostBtn}>
          Scanner
        </Link>
      </div>
    );
  } else if (hasTicket) {
    action = (
      <div className="grid grid-cols-[1.4fr_1fr] gap-2">
        <Link href={`/events/${pda}/ticket`} className={ctaBtn}>
          View ticket
        </Link>
        <Link href={`/events/${pda}/claim`} className={ghostBtn}>
          Claim / refund
        </Link>
      </div>
    );
  } else if (blocker === "sold_out") {
    action = (
      <p className="rounded-full bg-elevated/60 px-5 py-3.5 text-center text-sm font-medium text-foreground/70">
        Sold out
      </p>
    );
  } else if (blocker === "cancelled") {
    action = (
      <p className="rounded-full bg-destructive/10 px-5 py-3.5 text-center text-sm font-medium text-destructive">
        This event was cancelled.
      </p>
    );
  } else if (blocker === "ended") {
    action = (
      <p className="rounded-full bg-elevated/60 px-5 py-3.5 text-center text-sm font-medium text-foreground/70">
        This event has ended.
      </p>
    );
  } else {
    action = (
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => void join()}
          disabled={joining || ticket === undefined || insufficient}
          className={ctaBtn}
        >
          {joining
            ? "Confirm in your wallet..."
            : `Reserve your place · ${formatSol(event.entryFee)} SOL`}
          {!joining && (
            <ArrowRightIcon className="absolute right-5 size-5 transition group-hover:translate-x-0.5" />
          )}
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

  const when = formatEventWhen(event.startTs, event.endTs);
  const left = Math.max(0, event.capacity - event.ticketsSold);
  const filled = fillPercent(event.ticketsSold, event.capacity);
  const unlocked = isHost || hasTicket;
  const badge: { tone: Tone; label: string; dot?: boolean } =
    eventStatusLabel(event.status) === "Cancelled"
      ? { tone: "danger", label: "Cancelled" }
      : phase === "over" || eventStatusLabel(event.status) === "Ended"
        ? { tone: "neutral", label: "Ended" }
        : phase === "live"
          ? { tone: "champagne", label: "Live now", dot: true }
          : { tone: "chrome", label: "Upcoming" };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5">
      <article className="overflow-hidden rounded-3xl border border-border-low bg-surface">
        <EventHero seed={pda} coverUrl={summary?.coverUrl}>
          <Pill tone={badge.tone} dot={badge.dot}>
            {badge.label}
          </Pill>
        </EventHero>

        <div className="space-y-6 p-5 pt-3 sm:p-7 sm:pt-4">
          <header>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
              {title}
            </h1>
            {summary?.summary && (
              <p className="mt-2.5 max-w-prose text-[15px] leading-relaxed text-foreground/60">
                {summary.summary}
              </p>
            )}
            {summary === null && (
              <p className="mt-2 text-xs text-muted">
                No title or description is registered for this event.
              </p>
            )}
          </header>

          <ul className="space-y-4">
            <Fact icon={<CalendarIcon />} title={when.date} sub={when.time} />
            <Fact
              icon={unlocked ? <MapPinIcon /> : <LockIcon />}
              title={unlocked ? "Location unlocked" : "Location after you join"}
              sub={
                unlocked
                  ? "See the full details below"
                  : "Exact address is shared with guests only"
              }
            />
            <Fact
              icon={<TicketIcon />}
              title={
                left === 0
                  ? "Sold out"
                  : `${left} of ${event.capacity} spots left`
              }
              sub={
                event.checkedIn > 0
                  ? `${event.ticketsSold} joined · ${event.checkedIn} checked in`
                  : `${event.ticketsSold} joined`
              }
            >
              <div
                role="progressbar"
                aria-valuenow={filled}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Spots taken"
                className="mt-2.5 h-1 w-full max-w-xs overflow-hidden rounded-full bg-white/10"
              >
                <div
                  className="h-full rounded-full bg-champagne transition-[width] duration-700"
                  style={{ width: `${filled}%` }}
                />
              </div>
            </Fact>
          </ul>

          {action}

          <div className="space-y-2.5">
            <MoneyStrip
              items={[
                {
                  icon: <PoolIcon />,
                  label: "Pool",
                  value:
                    pool === undefined ? "..." : `${formatSol(pool, 4)} SOL`,
                },
                {
                  icon: <GiftIcon />,
                  label: "Attendee payout",
                  value: `${event.payoutBps / 100}% of pool`,
                },
                {
                  icon: <HostIcon />,
                  label: "Host",
                  value: ellipsify(event.host),
                },
              ]}
            />
            <p className="px-1 text-xs text-muted">
              The pool funds the event and pays guests who show up. Entry{" "}
              {formatSol(event.entryFee)} SOL.
            </p>
          </div>
        </div>
      </article>

      {member && !isHost && (
        <ProposeSponsorship pda={pda} event={event} vendor={member} />
      )}

      {keyWarning && (
        <p
          role="alert"
          className="rounded-2xl border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive"
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
        <p className="px-1 text-xs text-muted">
          Location and details unlock after you join.
        </p>
      )}
    </div>
  );
}
