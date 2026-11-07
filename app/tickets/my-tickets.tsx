"use client";

import Link from "next/link";
import {
  EventCard,
  eventCardStatus,
  useEventClock,
} from "../components/event-card";
import type { Event, Ticket } from "../generated/event_pool";
import { useWallet } from "../lib/wallet/context";
import { ellipsify } from "../lib/explorer";
import { parseEventList } from "../lib/event-summary";
import {
  eventStatusLabel,
  formatSol,
  memberView,
  useEventSummary,
  useEventsByAddress,
  useMemberTickets,
  type MemberView,
} from "../lib/event-pool";

function cta(pda: string, view: MemberView | null) {
  switch (view?.kind) {
    case "claimable":
      return {
        href: `/events/${pda}/claim`,
        label: `Claim ${formatSol(view.amount, 6)} SOL`,
        strong: true,
      };
    case "refundable":
      return {
        href: `/events/${pda}/claim`,
        label: `Refund ${formatSol(view.amount, 6)} SOL`,
        strong: true,
      };
    case "claimed":
      return {
        href: `/events/${pda}/claim`,
        label: `Claimed ${formatSol(view.amount, 6)} SOL`,
        strong: false,
      };
    case "not_checked_in":
      return {
        href: `/events/${pda}/claim`,
        label: "No payout",
        strong: false,
      };
    default:
      return {
        href: `/events/${pda}/ticket`,
        label: "View ticket",
        strong: false,
      };
  }
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-xl">
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
        My tickets
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-foreground/60">
        Events you have joined, with your ticket, claim and refund actions.
      </p>
      <div className="mt-6">{children}</div>
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card p-6 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-xs text-muted">{body}</p>
    </div>
  );
}

function MyTicketCard({
  ticket,
  event,
  now,
}: {
  ticket: Ticket;
  event?: Event | null;
  now: number;
}) {
  const pda = ticket.event;
  const { summary, isLoading } = useEventSummary(pda);
  const [listing] = parseEventList([
    {
      ...summary,
      eventPda: pda,
      title:
        summary?.title ??
        (isLoading ? "Loading event…" : `Event ${ellipsify(pda, 6)}`),
      onchain: event
        ? {
            startTs: Number(event.startTs),
            endTs: Number(event.endTs),
            status: eventStatusLabel(event.status).toLowerCase(),
            entryFee: event.entryFee,
            capacity: event.capacity,
            ticketsSold: event.ticketsSold,
          }
        : summary?.onchain,
    },
  ]);
  const action = cta(pda, event ? memberView(event, ticket) : null);

  return (
    <li className="rounded-2xl border border-border-low bg-card">
      <EventCard event={listing} label={eventCardStatus(listing, now)} />
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <p className="text-xs text-muted">
          {ticket.checkedIn ? "Checked in" : "Ticket reserved"}
        </p>
        <Link
          href={action.href}
          className={`shrink-0 rounded-xl px-3 py-2 text-xs font-medium ${
            action.strong
              ? "bg-primary text-primary-foreground"
              : "border border-border hover:bg-cream"
          }`}
        >
          {action.label}
        </Link>
      </div>
    </li>
  );
}

export function MyTickets() {
  const { wallet } = useWallet();
  const now = useEventClock();
  const member = wallet?.account.address;
  const { tickets, isLoading, error } = useMemberTickets(member);
  const { events } = useEventsByAddress(
    (tickets ?? []).map((t) => t.data.event)
  );

  if (!wallet) {
    return (
      <Shell>
        <Empty
          title="Connect your wallet"
          body="Connect the wallet you joined events with to see your tickets."
        />
      </Shell>
    );
  }
  if (error) {
    return (
      <Shell>
        <Empty title="Could not load tickets" body={error.message} />
      </Shell>
    );
  }
  if (isLoading || tickets === undefined) {
    return (
      <Shell>
        <Empty
          title="Loading tickets..."
          body="Reading your tickets on-chain."
        />
      </Shell>
    );
  }
  if (tickets.length === 0) {
    return (
      <Shell>
        <Empty
          title="No tickets yet"
          body="Join an event and your ticket will show up here."
        />
      </Shell>
    );
  }

  return (
    <Shell>
      <h2 className="sr-only">Your events</h2>
      <ul className="space-y-3">
        {tickets.map((t) => (
          <MyTicketCard
            key={t.address}
            ticket={t.data}
            event={events?.get(t.data.event)}
            now={now}
          />
        ))}
      </ul>
    </Shell>
  );
}
