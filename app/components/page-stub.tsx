import Link from "next/link";
import type { ReactNode } from "react";

type PageStubProps = {
  title: string;
  description: string;
  /** Ticket id that will replace this stub, e.g. "T22". */
  ticket: string;
  /** Event PDA for `/events/[pda]/*` routes. */
  pda?: string;
  children?: ReactNode;
};

/** Placeholder body for routes that later tickets fill in. Mobile-first single column. */
export function PageStub({
  title,
  description,
  ticket,
  pda,
  children,
}: PageStubProps) {
  return (
    <div className="mx-auto w-full max-w-xl">
      {pda && (
        <Link
          href={`/events/${pda}`}
          className="mb-4 inline-flex text-xs font-medium text-muted underline-offset-4 hover:text-foreground hover:underline"
        >
          &larr; Event
        </Link>
      )}
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
      {pda && (
        <p className="mt-1 break-all font-mono text-xs text-muted">{pda}</p>
      )}
      <p className="mt-3 text-sm leading-relaxed text-foreground/60">
        {description}
      </p>
      <div className="mt-6 rounded-2xl border border-dashed border-border bg-card p-6 text-center">
        <p className="text-sm font-medium">Coming soon</p>
        <p className="mt-1 text-xs text-muted">Built in {ticket}.</p>
      </div>
      {children}
    </div>
  );
}
