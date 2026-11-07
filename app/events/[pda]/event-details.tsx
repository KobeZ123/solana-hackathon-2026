"use client";

import { useState } from "react";
import useSWR from "swr";
import { useAuth } from "../../lib/hooks/use-auth";
import { fetchEventDetails } from "../../lib/event-pool";
import { ApiError } from "../../lib/api-client";
import { LockIcon, MapPinIcon } from "../../components/icons";

/** Pull `{ location, description }` out of the stored details; fall back to JSON text. */
export function readDetails(details: unknown): {
  location?: string;
  description?: string;
  raw?: string;
} {
  if (details && typeof details === "object") {
    const d = details as Record<string, unknown>;
    const location = typeof d.location === "string" ? d.location : undefined;
    const description =
      typeof d.description === "string" ? d.description : undefined;
    if (location !== undefined || description !== undefined) {
      return { location, description };
    }
  }
  if (typeof details === "string") return { description: details };
  return { raw: JSON.stringify(details, null, 2) };
}

/**
 * Gated details for the host and ticket holders. Requires a wallet sign-in
 * (one message signature per session) before calling the details endpoint.
 */
export function EventDetails({ pda, wallet }: { pda: string; wallet: string }) {
  const { token, ensureToken, isSigningIn } = useAuth();
  const [signInError, setSignInError] = useState<string | null>(null);

  const { data, error, isLoading } = useSWR(
    token ? (["event-details", pda, wallet, token] as const) : null,
    ([, address]) => fetchEventDetails(address),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );

  if (!token) {
    return (
      <div className="rounded-3xl border border-lavender/25 bg-lavender/[0.06] p-5 sm:p-6">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <LockIcon className="size-4 text-lavender" />
          Event details
        </h2>
        <p className="mt-1.5 text-sm text-foreground/60">
          Location and details are visible to the host and ticket holders. Sign
          in with your wallet to unlock them.
        </p>
        <button
          type="button"
          disabled={isSigningIn}
          onClick={() => {
            setSignInError(null);
            ensureToken().catch((err) =>
              setSignInError(err instanceof Error ? err.message : String(err))
            );
          }}
          className="mt-4 h-11 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:brightness-110 disabled:opacity-60"
        >
          {isSigningIn ? "Waiting for signature..." : "Sign in to view details"}
        </button>
        {signInError && (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {signInError}
          </p>
        )}
      </div>
    );
  }

  const shown = data ? readDetails(data.details) : null;

  return (
    <section className="rounded-3xl border border-border-low bg-surface p-5 sm:p-6">
      <h2 className="text-xs font-semibold tracking-wide text-muted uppercase">
        About this event
      </h2>
      {isLoading && <p className="mt-3 text-sm text-muted">Loading...</p>}
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error instanceof ApiError && error.status === 403
            ? "A ticket for this event is required to see the details."
            : error instanceof Error
              ? error.message
              : "Could not load details"}
        </p>
      )}
      {shown && (
        <div className="mt-4 space-y-5 text-[15px]">
          {shown.location && (
            <div className="flex items-start gap-3.5">
              <MapPinIcon className="mt-0.5 shrink-0 text-mint" />
              <div>
                <p className="font-medium whitespace-pre-wrap">
                  {shown.location}
                </p>
                <p className="mt-0.5 text-sm text-foreground/50">
                  Shared with guests only
                </p>
              </div>
            </div>
          )}
          {shown.description && (
            <p className="leading-relaxed whitespace-pre-wrap text-foreground/75">
              {shown.description}
            </p>
          )}
          {shown.raw && (
            <pre className="overflow-x-auto text-xs">{shown.raw}</pre>
          )}
        </div>
      )}
    </section>
  );
}
