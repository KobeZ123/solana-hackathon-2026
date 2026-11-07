import Link from "next/link";
import { useEffect, useState } from "react";
import type { Lamports } from "@solana/kit";
import { lamportsToSolString } from "../lib/lamports";
import type { EventListItem } from "../lib/event-summary";
import { ArrowRightIcon, CalendarIcon, TicketIcon } from "./icons";

export function useEventClock() {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now() / 1000), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
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

export function eventCardStatus(event: EventListItem, now: number) {
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

export function EventCard({
  event,
  label,
}: {
  event: EventListItem;
  label: string;
}) {
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
  );
}
