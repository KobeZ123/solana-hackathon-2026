"use client";

import { useState } from "react";
import useSWR from "swr";
import { useAuth } from "../../lib/hooks/use-auth";
import { fetchEventDetails } from "../../lib/event-pool";
import { ApiError } from "../../lib/api-client";

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
      <div className="rounded-2xl border border-border-low bg-card p-5">
        <h2 className="text-sm font-semibold">Event details</h2>
        <p className="mt-1 text-sm text-foreground/60">
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
          className="mt-3 h-10 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60"
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
    <div className="rounded-2xl border border-border-low bg-card p-5">
      <h2 className="text-sm font-semibold">Event details</h2>
      {isLoading && <p className="mt-2 text-sm text-muted">Loading...</p>}
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error instanceof ApiError && error.status === 403
            ? "A ticket for this event is required to see the details."
            : error instanceof Error
              ? error.message
              : "Could not load details"}
        </p>
      )}
      {shown && (
        <dl className="mt-3 space-y-3 text-sm">
          {shown.location && (
            <div>
              <dt className="text-xs text-muted">Location</dt>
              <dd className="whitespace-pre-wrap">{shown.location}</dd>
            </div>
          )}
          {shown.description && (
            <div>
              <dt className="text-xs text-muted">Details</dt>
              <dd className="whitespace-pre-wrap">{shown.description}</dd>
            </div>
          )}
          {shown.raw && (
            <pre className="overflow-x-auto text-xs">{shown.raw}</pre>
          )}
        </dl>
      )}
    </div>
  );
}
