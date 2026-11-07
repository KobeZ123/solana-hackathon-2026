import Link from "next/link";
import { EventList } from "./components/event-list";
import {
  ArrowRightIcon,
  GiftIcon,
  HostIcon,
  PoolIcon,
  TicketIcon,
  VendorIcon,
} from "./components/icons";

const benefits = [
  {
    icon: HostIcon,
    title: "Real headcount",
    copy: "A paid RSVP gives hosts a headcount they can plan around.",
  },
  {
    icon: PoolIcon,
    title: "Funded up front",
    copy: "Entry fees go into an on-chain pool for the event.",
  },
  {
    icon: GiftIcon,
    title: "Showing up pays",
    copy: "Checked-in guests split the attendee share after the event.",
  },
  {
    icon: TicketIcon,
    title: "Fast check-in",
    copy: "Scan a signed ticket QR that refreshes every 20 seconds.",
  },
  {
    icon: VendorIcon,
    title: "Vendors on-chain",
    copy: "Approved vendors get paid from the pool after delivery is confirmed.",
  },
];

export default function Home() {
  return (
    <div className="space-y-12 sm:space-y-16">
      <section className="overflow-hidden rounded-2xl border border-border bg-surface">
        <div className="landing-hero relative isolate px-5 py-10 sm:px-10 sm:py-16">
          <div className="relative max-w-[37rem]">
            <p className="mb-5 text-xs font-medium tracking-[0.2em] text-champagne uppercase">
              Events with a stake
            </p>
            <h1 className="text-[clamp(2rem,5vw,3.5rem)] leading-[1.04] font-semibold tracking-[-0.055em]">
              <span className="block text-balance">
                Host events people actually show up to.
              </span>{" "}
              <span className="mt-2 block text-balance text-foreground/75">
                Build communities people actually care about.
              </span>
            </h1>
            <p className="mt-5 max-w-md text-sm leading-relaxed text-foreground/75 sm:text-base">
              SOLSocial turns every RSVP into a small Solana payment. Fees fund
              the event, hosts know who is really coming, and everyone who shows
              up shares the pool.
            </p>
            <div className="mt-7 flex flex-wrap gap-2.5">
              <Link
                href="/events/new"
                className="button-metal inline-flex min-h-11 items-center gap-2 rounded-full px-5 text-sm font-semibold"
              >
                Host an event <ArrowRightIcon className="size-4" />
              </Link>
              <a
                href="#events"
                className="inline-flex min-h-11 items-center rounded-full border border-border bg-background/75 px-5 text-sm font-medium transition hover:bg-elevated"
              >
                Browse events
              </a>
            </div>
          </div>
        </div>

        <ul
          aria-label="How it works"
          className="grid grid-cols-2 gap-px border-t border-border bg-border-low md:grid-cols-5"
        >
          {benefits.map(({ icon: Icon, title, copy }) => (
            <li
              key={title}
              className="bg-surface px-4 py-5 last:col-span-2 sm:p-6 md:last:col-span-1"
            >
              <Icon className="mb-2 size-5 text-champagne" />
              <p className="text-sm font-semibold">{title}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted">{copy}</p>
            </li>
          ))}
        </ul>
      </section>

      <section
        id="events"
        aria-labelledby="events-heading"
        className="scroll-mt-20"
      >
        <h2
          id="events-heading"
          className="text-3xl font-semibold tracking-tight sm:text-4xl"
        >
          Discover events
        </h2>
        <p className="mt-2 mb-5 text-sm text-muted sm:text-base">
          Find a gathering, reserve a spot, and meet the people building
          alongside you.
        </p>
        <EventList />
      </section>
    </div>
  );
}
