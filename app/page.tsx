import Link from "next/link";
import { EventList } from "./components/event-list";

export default function Home() {
  return (
    <div className="space-y-10">
      <section className="pt-2 sm:pt-6">
        <h1 className="text-4xl font-black tracking-tight sm:text-6xl">
          Host events people
          <br />
          actually show up to.
        </h1>
        <p className="mt-4 max-w-xl text-base leading-relaxed text-foreground/60">
          SOLSocial turns every RSVP into a small Solana payment. Fees fund the
          event, hosts know who is really coming, and everyone who shows up
          shares the pool.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/events/new"
            className="inline-flex h-11 items-center rounded-xl bg-primary px-5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
          >
            Host an event
          </Link>
          <a
            href="#events"
            className="inline-flex h-11 items-center rounded-xl border border-border-low bg-card px-5 text-sm font-medium transition hover:bg-cream"
          >
            Browse events
          </a>
        </div>
      </section>

      <section aria-labelledby="how-heading">
        <h2 id="how-heading" className="mb-4 text-lg font-semibold">
          How it works
        </h2>
        <ol className="grid gap-3 sm:grid-cols-3">
          {[
            [
              "Join with a payment",
              "Your RSVP is a small SOL entry fee, so hosts know who is really coming.",
            ],
            [
              "Show your pass",
              "Your QR refreshes every 20 seconds. Scan at the door to check in on-chain.",
            ],
            [
              "Get paid for showing up",
              "After the event, attendees split a share of the pool.",
            ],
          ].map(([title, body], i) => (
            <li
              key={title}
              className="rounded-xl border border-border-low bg-card p-4"
            >
              <span className="text-xs font-semibold text-foreground/50">
                Step {i + 1}
              </span>
              <p className="mt-1 text-sm font-semibold">{title}</p>
              <p className="mt-1 text-sm leading-relaxed text-foreground/60">
                {body}
              </p>
            </li>
          ))}
        </ol>
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
