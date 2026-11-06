import Link from "next/link";
import { EventList } from "./components/event-list";

export default function Home() {
  return (
    <div className="space-y-10">
      <section className="pt-2 sm:pt-6">
        <h1 className="text-4xl font-black tracking-tight sm:text-6xl">
          Show up.
          <br />
          Get paid.
        </h1>
        <p className="mt-4 max-w-xl text-base leading-relaxed text-foreground/60">
          Event Pool holds every entry fee in an on-chain pool. Guests who
          actually check in split a share of it, so a ticket is a commitment,
          not a no-show.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/events/new"
            className="inline-flex h-11 items-center rounded-xl bg-primary px-5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
          >
            Create an event
          </Link>
          <a
            href="#events"
            className="inline-flex h-11 items-center rounded-xl border border-border-low bg-card px-5 text-sm font-medium transition hover:bg-cream"
          >
            Browse events
          </a>
        </div>
      </section>

      <section
        id="events"
        aria-labelledby="events-heading"
        className="scroll-mt-20"
      >
        <h2 id="events-heading" className="mb-4 text-lg font-semibold">
          Upcoming events
        </h2>
        <EventList />
      </section>
    </div>
  );
}
