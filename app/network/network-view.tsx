"use client";

import Link from "next/link";
import useSWR from "swr";
import { apiJson } from "../lib/api-client";
import { useAuth } from "../lib/hooks/use-auth";
import { useWallet } from "../lib/wallet/context";
import { ellipsify } from "../lib/explorer";
import {
  parseNetwork,
  unlockNudge,
  type NetworkData,
  type NetworkPeer,
} from "../lib/network";

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border-low bg-card p-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold">{value}</dd>
    </div>
  );
}

function PeerRow({ peer }: { peer: NetworkPeer }) {
  return (
    <li className="rounded-2xl border border-border-low bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-sm">{ellipsify(peer.wallet)}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
            peer.strong ? "bg-primary/10 text-primary" : "bg-cream text-muted"
          }`}
        >
          {peer.strong ? "Strong tie" : "Weak tie"}
        </span>
      </div>
      <p className="mt-2 text-xs text-muted">
        {peer.sharedCount} shared {peer.sharedCount === 1 ? "event" : "events"}
      </p>
      <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
        {peer.sharedEvents.map((e) => (
          <li key={e.eventPda}>
            <Link
              href={`/events/${e.eventPda}`}
              className="text-xs underline-offset-4 hover:underline"
            >
              {e.title ?? ellipsify(e.eventPda)}
              {e.strong ? " (checked in)" : ""}
            </Link>
          </li>
        ))}
      </ul>
    </li>
  );
}

function Nudge({ data }: { data: NetworkData }) {
  const text = unlockNudge(data);
  if (!text || !data.nextUnlock) {
    return (
      <p className="rounded-2xl border border-dashed border-border bg-card p-4 text-sm text-muted">
        {data.unlockable > 0
          ? `${data.unlockable} network-only ${data.unlockable === 1 ? "event is" : "events are"} hidden from you. Join events to meet their hosts.`
          : "No hidden network events right now. Keep showing up to grow your circle."}
      </p>
    );
  }
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="text-sm font-semibold">{text}</p>
      <p className="mt-1 text-xs text-muted">
        Joining{" "}
        <Link
          href={`/events/${data.nextUnlock.eventPda}`}
          className="underline underline-offset-4"
        >
          {data.nextUnlock.title}
        </Link>{" "}
        connects you to its attendees. {data.unlockable} network-only{" "}
        {data.unlockable === 1 ? "event is" : "events are"} hidden from you now.
      </p>
    </div>
  );
}

export function NetworkView() {
  const { status } = useWallet();
  const { isAuthenticated, isSigningIn, signIn, error: authError } = useAuth();
  const { data, error, isLoading, mutate } = useSWR(
    isAuthenticated ? "network" : null,
    async () => parseNetwork(await apiJson("/api/me/network")),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );

  return (
    <div className="mx-auto w-full max-w-xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Your network</h1>
        <p className="mt-1 text-sm text-muted">
          People you share events with. A weak tie means you both hold a ticket;
          a strong tie means you both checked in. Network-only events from your
          connections show up in your feed.
        </p>
      </header>

      {!isAuthenticated ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
          {status === "connected" ? (
            <>
              <p className="text-sm font-medium">Sign in to see your network</p>
              <button
                type="button"
                disabled={isSigningIn}
                onClick={() => void signIn().catch(() => undefined)}
                className="mt-4 cursor-pointer rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground disabled:opacity-60"
              >
                {isSigningIn
                  ? "Waiting for signature..."
                  : "Sign in with wallet"}
              </button>
              {authError && (
                <p role="alert" className="mt-2 text-xs text-muted">
                  {authError.message}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm font-medium">
              Connect your wallet to see your network
            </p>
          )}
        </div>
      ) : isLoading ? (
        <div
          className="h-40 animate-pulse rounded-2xl border border-border-low bg-card"
          aria-hidden
        />
      ) : error || !data ? (
        <div
          role="alert"
          className="rounded-2xl border border-border-low bg-card p-6 text-center"
        >
          <p className="text-sm font-medium">Could not load your network</p>
          <button
            type="button"
            onClick={() => void mutate()}
            className="mt-4 cursor-pointer rounded-lg border border-border-low px-4 py-2 text-xs font-medium transition hover:bg-cream"
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Connections" value={data.totals.connections} />
            <Stat label="Strong ties" value={data.totals.strong} />
            <Stat label="Weak ties" value={data.totals.weak} />
            <Stat label="Events attended" value={data.totals.eventsAttended} />
          </dl>

          <Nudge data={data} />

          {data.peers.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
              <p className="text-sm font-medium">No connections yet</p>
              <p className="mt-1 text-xs text-muted">
                Join an event and you will be connected to everyone else who
                holds a ticket, including the host.
              </p>
              <Link
                href="/"
                className="mt-4 inline-flex rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground"
              >
                Browse events
              </Link>
            </div>
          ) : (
            <ul className="space-y-3">
              {data.peers.map((p) => (
                <PeerRow key={p.wallet} peer={p} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
