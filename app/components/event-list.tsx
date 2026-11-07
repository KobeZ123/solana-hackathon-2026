"use client";

import Link from "next/link";
import useSWR from "swr";
import type { Lamports } from "@solana/kit";
import { lamportsToSolString } from "../lib/lamports";
import { parseEventList, type EventListItem } from "../lib/event-summary";
import { apiFetch } from "../lib/api-client";
import { useAuth } from "../lib/hooks/use-auth";

/** Signed in: your feed (public + network events from your 1-hop circle); else public events. */
async function fetchEvents(signedIn: boolean): Promise<EventListItem[]> {
  if (signedIn) {
    const feed = await apiFetch("/api/feed");
    if (feed.ok) return parseEventList(await feed.json());
  }
  const res = await fetch("/api/events");
  if (!res.ok) throw new Error(`Events request failed (${res.status})`);
  return parseEventList(await res.json());
}

function formatStart(ts?: number): string | null {
  if (ts === undefined) return null;
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function EventCard({ event }: { event: EventListItem }) {
  const start = formatStart(event.startTs);
  const meta = [
    event.entryFee !== undefined
      ? `${lamportsToSolString(event.entryFee as Lamports, 3)} SOL`
      : null,
    event.capacity !== undefined
      ? `${event.ticketsSold ?? 0} / ${event.capacity} joined`
      : null,
    start,
  ].filter(Boolean);

  return (
    <li>
      <Link
        href={`/events/${event.pda}`}
        className="flex h-full flex-col gap-2 rounded-2xl border border-border-low bg-card p-4 transition hover:border-border hover:bg-cream"
      >
        {event.via && (
          <span className="w-fit rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
            From your network · via {event.via.title ?? "a shared event"}
            {event.via.strong ? " (strong tie)" : ""}
          </span>
        )}
        <h3 className="text-base font-semibold leading-snug">{event.title}</h3>
        {event.summary && (
          <p className="line-clamp-2 text-sm text-foreground/60">
            {event.summary}
          </p>
        )}
        {meta.length > 0 && (
          <p className="mt-auto pt-1 text-xs text-muted">{meta.join(" · ")}</p>
        )}
      </Link>
    </li>
  );
}

function Skeleton() {
  return (
    <ul className="grid gap-3 sm:grid-cols-2" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <li
          key={i}
          className="h-28 animate-pulse rounded-2xl border border-border-low bg-card"
        />
      ))}
    </ul>
  );
}

/** Public event list for the home page, with loading, empty and error states. */
export function EventList() {
  const { isAuthenticated } = useAuth();
  const { data, error, isLoading, mutate } = useSWR(
    ["events", isAuthenticated],
    ([, signedIn]) => fetchEvents(signedIn),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );

  if (isLoading) return <Skeleton />;

  if (error) {
    return (
      <div
        role="alert"
        className="rounded-2xl border border-border-low bg-card p-6 text-center"
      >
        <p className="text-sm font-medium">Could not load events</p>
        <p className="mt-1 text-xs text-muted">
          The events service may be starting up. Try again in a moment.
        </p>
        <button
          type="button"
          onClick={() => void mutate()}
          className="mt-4 cursor-pointer rounded-lg border border-border-low px-4 py-2 text-xs font-medium transition hover:bg-cream"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
        <p className="text-sm font-medium">No events yet</p>
        <p className="mt-1 text-xs text-muted">
          Be the first to host one. Guests pay a small fee, and those who show
          up split a share of the pool.
        </p>
        <Link
          href="/events/new"
          className="mt-4 inline-flex rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition hover:bg-primary/90"
        >
          Create an event
        </Link>
      </div>
    );
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {data.map((event) => (
        <EventCard key={event.pda} event={event} />
      ))}
    </ul>
  );
}
