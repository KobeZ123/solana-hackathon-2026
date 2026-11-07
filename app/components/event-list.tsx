"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { parseEventList, type EventListItem } from "../lib/event-summary";
import { apiFetch } from "../lib/api-client";
import { useAuth } from "../lib/hooks/use-auth";
import { EventCard, eventCardStatus, useEventClock } from "./event-card";

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

function Skeleton() {
  return (
    <ul className="grid gap-3" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <li
          key={i}
          className="h-36 motion-safe:animate-pulse rounded-2xl border border-border-low bg-card"
        />
      ))}
    </ul>
  );
}

/** Public event list for the home page, with loading, empty and error states. */
export function EventList() {
  const { isAuthenticated } = useAuth();
  const [showArchive, setShowArchive] = useState(false);
  const now = useEventClock();
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

  const listings = data.map((event) => ({
    event,
    label: eventCardStatus(event, now),
  }));
  const available = listings.filter(
    ({ label }) => label === "Upcoming" || label === "Live now"
  );
  const archive = listings.filter(
    ({ label }) => label === "Ended" || label === "Cancelled"
  );
  available.sort(
    (a, b) =>
      Number(Boolean(b.event.coverUrl)) - Number(Boolean(a.event.coverUrl)) ||
      (a.event.startTs ?? Infinity) - (b.event.startTs ?? Infinity)
  );
  const shown = showArchive ? archive : available;

  return (
    <>
      {archive.length > 0 && (
        <div
          className="mb-4 flex flex-wrap gap-2"
          aria-label="Filter events"
          role="group"
        >
          {[
            { archive: false, label: "Upcoming & live" },
            { archive: true, label: "Past & cancelled" },
          ].map((filter) => (
            <button
              key={filter.label}
              type="button"
              aria-pressed={showArchive === filter.archive}
              onClick={() => setShowArchive(filter.archive)}
              className="min-h-10 cursor-pointer rounded-full border border-border px-4 text-sm font-medium text-muted transition hover:bg-elevated aria-pressed:border-champagne/35 aria-pressed:bg-champagne/10 aria-pressed:text-foreground"
            >
              {filter.label}
            </button>
          ))}
        </div>
      )}
      {shown.length ? (
        <ul className="grid gap-3">
          {shown.map(({ event, label }) => (
            <li key={event.pda}>
              <EventCard event={event} label={label} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-2xl border border-border bg-card p-5 text-sm text-muted">
          No upcoming or live events.{" "}
          <Link
            href="/events/new"
            className="font-medium text-foreground underline underline-offset-4"
          >
            Host an event
          </Link>
        </p>
      )}
    </>
  );
}
