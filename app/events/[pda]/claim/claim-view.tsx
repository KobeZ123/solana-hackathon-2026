"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { Address } from "@solana/kit";
import {
  EventStatus,
  getClaimInstructionAsync,
  getRefundInstructionAsync,
} from "../../../generated/event_pool";
import { useCluster } from "../../../components/cluster-context";
import { useWallet } from "../../../lib/wallet/context";
import { useSendTransaction } from "../../../lib/hooks/use-send-transaction";
import { parseTransactionError } from "../../../lib/errors";
import { ellipsify } from "../../../lib/explorer";
import {
  eventStatusLabel,
  formatSol,
  formatTimestamp,
  memberView,
  useEvent,
  useTicket,
} from "../../../lib/event-pool";

function Panel({
  title,
  children,
  tone,
}: {
  title: string;
  children?: ReactNode;
  tone?: "good" | "neutral";
}) {
  return (
    <div
      className={`rounded-2xl border p-6 ${
        tone === "good"
          ? "border-green-600/40 bg-green-600/10"
          : "border-border-low bg-card"
      }`}
    >
      <p className="text-lg font-semibold">{title}</p>
      <div className="mt-2 space-y-3 text-sm text-foreground/70">
        {children}
      </div>
    </div>
  );
}

const primaryBtn =
  "flex h-12 w-full cursor-pointer items-center justify-center rounded-xl bg-primary text-sm font-medium text-primary-foreground disabled:opacity-60";

export function ClaimView({ pda }: { pda: string }) {
  const { cluster, getExplorerUrl } = useCluster();
  const { wallet, signer } = useWallet();
  const member = wallet?.account.address;
  const { send, isSending } = useSendTransaction();

  const { event, isLoading, mutate: mutateEvent } = useEvent(pda);
  const {
    ticket,
    ticketAddress,
    isLoading: ticketLoading,
    mutate: mutateTicket,
  } = useTicket(pda, member);

  const [lastTx, setLastTx] = useState<{
    kind: "claim" | "refund";
    sig: string;
  } | null>(null);

  const act = async (kind: "claim" | "refund") => {
    if (!signer) return;
    const input = { member: signer, event: pda as Address };
    try {
      const instruction =
        kind === "claim"
          ? await getClaimInstructionAsync(input)
          : await getRefundInstructionAsync(input);
      const sig = await send({ instructions: [instruction] });
      setLastTx({ kind, sig });
      toast.success(
        kind === "claim" ? "Payout claimed" : "Entry fee refunded",
        {
          action: {
            label: "Explorer",
            onClick: () => window.open(getExplorerUrl(`/tx/${sig}`), "_blank"),
          },
        }
      );
      await Promise.all([mutateEvent(), mutateTicket()]);
    } catch (err) {
      toast.error(parseTransactionError(err));
    }
  };

  const header = (
    <div>
      <Link
        href={`/events/${pda}`}
        className="mb-4 inline-flex text-xs font-medium text-muted underline-offset-4 hover:text-foreground hover:underline"
      >
        &larr; Event
      </Link>
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
        Claim or refund
      </h1>
      <p className="mt-1 break-all font-mono text-xs text-muted">{pda}</p>
    </div>
  );

  let body: ReactNode;
  if (isLoading || event === undefined) {
    body = <Panel title="Loading event..." />;
  } else if (event === null) {
    body = (
      <Panel title="Event not found">
        No event account at {ellipsify(pda)} on {cluster}. Check the cluster
        selector.
      </Panel>
    );
  } else if (!wallet) {
    body = (
      <Panel title="Connect your wallet">
        Connect the wallet you joined with to see your payout or refund.
      </Panel>
    );
  } else if (ticketLoading || ticket === undefined) {
    body = <Panel title="Looking up your ticket..." />;
  } else {
    const view = memberView(event, ticket);
    const txLink = (sig: string) => (
      <a
        href={getExplorerUrl(`/tx/${sig}`)}
        target="_blank"
        rel="noreferrer"
        className="underline"
      >
        View transaction
      </a>
    );
    switch (view.kind) {
      case "no_ticket":
        body = (
          <Panel title="No ticket for this wallet">
            {lastTx?.kind === "refund" ? (
              <>
                <p>Your entry fee was refunded.</p>
                {txLink(lastTx.sig)}
              </>
            ) : (
              <p>
                {wallet.account.address === event.host
                  ? "You are the host. Manage payouts from the host dashboard."
                  : event.status === EventStatus.Cancelled
                    ? "This event was cancelled. If you already refunded, your ticket is closed and there is nothing more to do."
                    : "This wallet did not join this event."}
              </p>
            )}
            {wallet.account.address === event.host && (
              <Link href={`/events/${pda}/host`} className="underline">
                Open host dashboard
              </Link>
            )}
          </Panel>
        );
        break;
      case "open":
        body = (
          <Panel title="The event has not ended yet">
            <p>
              Payouts open once the host ends the event (status:{" "}
              {eventStatusLabel(event.status)}, scheduled end{" "}
              {formatTimestamp(event.endTs)}). If you checked in, you can claim
              your share then.
            </p>
            <Link href={`/events/${pda}/ticket`} className="underline">
              View your ticket
            </Link>
          </Panel>
        );
        break;
      case "claimable":
        body = (
          <Panel
            title={`You can claim ${formatSol(view.amount, 6)} SOL`}
            tone="good"
          >
            <p>
              The event ended and you checked in. Your share of the attendee
              pool is paid from the event vault to your wallet.
            </p>
            <button
              type="button"
              disabled={isSending}
              onClick={() => void act("claim")}
              className={primaryBtn}
            >
              {isSending
                ? "Confirm in your wallet..."
                : `Claim ${formatSol(view.amount, 6)} SOL`}
            </button>
          </Panel>
        );
        break;
      case "claimed":
        body = (
          <Panel title={`Claimed ${formatSol(view.amount, 6)} SOL`} tone="good">
            <p>Your payout has been sent to your wallet.</p>
            {lastTx?.kind === "claim" ? (
              txLink(lastTx.sig)
            ) : ticketAddress ? (
              <a
                href={getExplorerUrl(`/address/${ticketAddress}`)}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                View your ticket account on Explorer
              </a>
            ) : null}
          </Panel>
        );
        break;
      case "not_checked_in":
        body = (
          <Panel title="No payout for this ticket">
            <p>
              Only attendees who were checked in at the door share the pool, and
              this ticket was never checked in.
            </p>
          </Panel>
        );
        break;
      case "refundable":
        body = (
          <Panel title="This event was cancelled" tone="good">
            <p>
              You can get your entry fee of{" "}
              <strong>{formatSol(view.amount, 6)} SOL</strong> back. Refunding
              closes your ticket.
            </p>
            <button
              type="button"
              disabled={isSending}
              onClick={() => void act("refund")}
              className={primaryBtn}
            >
              {isSending
                ? "Confirm in your wallet..."
                : `Refund ${formatSol(view.amount, 6)} SOL`}
            </button>
          </Panel>
        );
        break;
    }
  }

  return (
    <div className="mx-auto w-full max-w-xl space-y-5">
      {header}
      {body}
    </div>
  );
}
