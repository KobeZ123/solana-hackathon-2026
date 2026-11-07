"use client";

import Link from "next/link";
import { useCallback, useSyncExternalStore, type ReactNode } from "react";
import { SponsorshipStatus } from "../../../generated/event_pool";
import { QrDisplay } from "../../../components/qr-display";
import { SettleVendorButton } from "../../../components/settle-vendor-button";
import { useWallet } from "../../../lib/wallet/context";
import { ellipsify } from "../../../lib/explorer";
import {
  createDeliveryPayload,
  encodeDeliveryPayload,
  loadVendorKey,
} from "../../../lib/qr";
import {
  formatSol,
  sponsorshipStatusLabel,
  useEvent,
  useEventSummary,
  useSponsorship,
  useVendorProfile,
} from "../../../lib/event-pool";
import { EventStatus } from "../../../generated/event_pool";

function Notice({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-border-low bg-card p-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children && (
        <div className="mt-2 space-y-3 text-sm text-foreground/60">
          {children}
        </div>
      )}
    </div>
  );
}

const secondaryBtn =
  "flex h-12 items-center justify-center rounded-xl border border-border bg-card px-4 text-sm font-medium transition hover:bg-cream";

/** Vendor delivery pass: a rotating `delivery:` QR signed by the vendor key. */
export function VendorPassView({ pda }: { pda: string }) {
  const { wallet, status } = useWallet();
  const vendor = wallet?.account.address;

  const { event } = useEvent(pda);
  const { summary } = useEventSummary(pda);
  const { profile } = useVendorProfile(vendor);
  const {
    sponsorship,
    sponsorshipAddress,
    mutate: mutateSponsorship,
  } = useSponsorship(pda, vendor, 5_000);

  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  const storedKey = mounted && vendor ? loadVendorKey(vendor) : null;
  // A stored secret only counts if it matches the key registered on-chain.
  const key =
    storedKey && profile && storedKey.publicKey === profile.vendorKey
      ? storedKey
      : null;

  const getPayload = useCallback(
    () =>
      encodeDeliveryPayload(
        createDeliveryPayload({
          event: pda,
          vendor: vendor as string,
          secretKey: (key as { secretKey: string }).secretKey,
        })
      ),
    [pda, vendor, key]
  );

  const back = (
    <Link
      href={`/events/${pda}`}
      className="mb-4 inline-flex text-xs font-medium text-muted underline-offset-4 hover:text-foreground hover:underline"
    >
      &larr; Event
    </Link>
  );

  let body: ReactNode;
  if (status === "connecting") {
    body = <p className="text-sm text-muted">Connecting wallet...</p>;
  } else if (!wallet || !vendor) {
    body = (
      <Notice title="Connect your wallet">
        <p>Connect the vendor wallet to show your delivery pass.</p>
      </Notice>
    );
  } else if (
    event === undefined ||
    profile === undefined ||
    sponsorship === undefined
  ) {
    body = (
      <div className="h-64 animate-pulse rounded-2xl bg-card" aria-hidden />
    );
  } else if (event === null) {
    body = (
      <Notice title="Event not found">
        <p>There is no event at this address on the selected cluster.</p>
      </Notice>
    );
  } else if (profile === null) {
    body = (
      <Notice title="Not registered as a vendor">
        <p>Register this wallet first.</p>
        <Link href="/vendor" className={secondaryBtn}>
          Vendor page
        </Link>
      </Notice>
    );
  } else if (sponsorship === null) {
    body = (
      <Notice title="No sponsorship for this event">
        <p>
          {ellipsify(vendor)} has not proposed a sponsorship here. Propose one
          from the event page.
        </p>
        <Link href={`/events/${pda}`} className={secondaryBtn}>
          Go to event
        </Link>
      </Notice>
    );
  } else if (sponsorship.status === SponsorshipStatus.Proposed) {
    body = (
      <Notice title="Waiting for the host">
        <p>
          Your {formatSol(sponsorship.amount, 6)} SOL proposal has not been
          approved yet. The pass works once the host approves it.
        </p>
      </Notice>
    );
  } else if (sponsorship.status === SponsorshipStatus.Rejected) {
    body = (
      <Notice title="Sponsorship rejected">
        <p>
          The host rejected or released this sponsorship. No payment is due.
        </p>
      </Notice>
    );
  } else if (
    sponsorship.status === SponsorshipStatus.Delivered ||
    sponsorship.status === SponsorshipStatus.Paid
  ) {
    const paid = sponsorship.status === SponsorshipStatus.Paid;
    const ended = event.status === EventStatus.Ended;
    body = (
      <div
        role="status"
        className="rounded-3xl bg-green-600 p-8 text-center text-white"
      >
        <div aria-hidden className="text-6xl">
          &#10003;
        </div>
        <h2 className="mt-3 text-2xl font-bold">
          {paid ? "You have been paid" : "Delivery confirmed"}
        </h2>
        <p className="mt-1 text-sm opacity-90">
          {paid
            ? `${formatSol(sponsorship.amount, 6)} SOL was sent to your wallet.`
            : ended
              ? "The event has ended. Payment can be settled now."
              : "You are paid once the host ends the event. Anyone can then settle it."}
        </p>
        {!paid && sponsorshipAddress && (
          <div className="mt-4 flex justify-center">
            <SettleVendorButton
              event={pda}
              sponsorship={sponsorshipAddress}
              vendor={vendor}
              eventEnded={ended}
              onDone={() => mutateSponsorship()}
              className="h-11 cursor-pointer rounded-xl bg-white px-5 text-sm font-medium text-green-700 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>
        )}
      </div>
    );
  } else if (!key) {
    body = (
      <Notice title="Pass key not found in this browser">
        <p>
          Your registered pass key has no secret here, so a valid QR cannot be
          made. Open this page in the browser you registered with.
        </p>
      </Notice>
    );
  } else {
    body = (
      <div className="space-y-4 text-center">
        <div className="flex justify-center">
          <QrDisplay getPayload={getPayload} />
        </div>
        <p className="text-sm text-muted">
          Show this to the host&apos;s scanner when you deliver. The code
          refreshes every 20 seconds, so screenshots do not work.
        </p>
        <p className="text-xs text-muted">
          {sponsorshipStatusLabel(sponsorship.status)} &middot;{" "}
          {formatSol(sponsorship.amount, 6)} SOL
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md space-y-4">
      <div>
        {back}
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Vendor pass
        </h1>
        {summary?.title && (
          <p className="mt-1 text-sm text-muted">{summary.title}</p>
        )}
      </div>
      {body}
    </div>
  );
}
