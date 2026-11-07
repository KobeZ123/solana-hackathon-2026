"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRightIcon, CalendarIcon, TicketIcon } from "./icons";
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

function statusLabel(event: EventListItem, now: number) {
  if (event.status === "cancelled") return "Cancelled";
  if (
    event.status === "ended" ||
    (event.endTs !== undefined && event.endTs <= now)
  )
    return "Ended";
  if (
    event.startTs !== undefined &&
    event.startTs <= now &&
    event.endTs !== undefined
  )
    return "Live now";
  return "Upcoming";
}

function EventCard({ event, label }: { event: EventListItem; label: string }) {
  const start = formatStart(event.startTs);
  const remaining =
    event.capacity === undefined
      ? undefined
      : Math.max(0, event.capacity - (event.ticketsSold ?? 0));
  const availability =
    remaining === 0
      ? "Sold out"
      : remaining !== undefined && remaining <= 3
        ? `${remaining} ${remaining === 1 ? "spot" : "spots"} left`
        : event.ticketsSold !== undefined
          ? `${event.ticketsSold} joined`
          : null;
  const fee =
    event.entryFee === undefined
      ? null
      : `${lamportsToSolString(event.entryFee as Lamports, 9)} SOL`;
  const active = label === "Upcoming" || label === "Live now";

  return (
    <li>
      <Link
        href={`/events/${event.pda}`}
        className={`group relative isolate flex min-h-44 items-end overflow-hidden rounded-2xl border border-border p-4 transition hover:border-champagne/55 sm:min-h-36 sm:p-5 ${event.coverUrl ? "bg-[#090a0b] text-ivory" : "bg-card"}`}
      >
        {event.coverUrl && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={event.coverUrl}
              alt=""
              loading="lazy"
              className="absolute inset-y-0 right-0 -z-20 h-full w-full object-cover object-[65%_48%] motion-safe:transition-transform motion-safe:duration-500 motion-safe:group-hover:scale-[1.025] sm:w-[64%]"
            />
            <div className="event-photo-shade absolute inset-0 -z-10" />
          </>
        )}
        <div className="min-w-0 flex-1 pr-2">
          <div className="flex flex-wrap gap-2">
            <span
              className={`rounded-full border border-current/15 px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase ${label === "Live now" ? "text-champagne" : "text-current/85"}`}
            >
              {label}
            </span>
            {event.via && (
              <span className="text-xs text-current/80">
                Via {event.via.title ?? "a shared event"}
                {event.via.strong ? " (strong tie)" : ""}
              </span>
            )}
          </div>
          <h3 className="mt-1.5 text-xl font-semibold tracking-tight break-words sm:text-2xl">
            {event.title}
          </h3>
          {event.summary && (
            <p className="mt-1 line-clamp-2 max-w-md text-sm text-current/80">
              {event.summary}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-current/90">
            {start && (
              <span className="inline-flex items-center gap-1.5">
                <CalendarIcon className="size-3.5" />
                {start}
              </span>
            )}
            {active && availability && (
              <span className="inline-flex items-center gap-1.5">
                <TicketIcon className="size-3.5" />
                {availability}
              </span>
            )}
            {active && fee && (
              <span className="font-medium tabular-nums">{fee}</span>
            )}
          </div>
        </div>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-current/20 bg-current/5 transition group-hover:border-current/60">
          <ArrowRightIcon className="size-4" />
        </span>
      </Link>
    </li>
  );
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
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now() / 1000), 30_000);
    return () => window.clearInterval(timer);
  }, []);
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
    label: statusLabel(event, now),
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
            <EventCard key={event.pda} event={event} label={label} />
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
