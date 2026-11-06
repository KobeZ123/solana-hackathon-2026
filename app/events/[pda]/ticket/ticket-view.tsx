"use client";

import Link from "next/link";
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { toast } from "sonner";
import type { Address } from "@solana/kit";
import { getRotateTicketKeyInstruction } from "../../../generated/event_pool";
import { useCluster } from "../../../components/cluster-context";
import { QrDisplay } from "../../../components/qr-display";
import { useWallet } from "../../../lib/wallet/context";
import { useSendTransaction } from "../../../lib/hooks/use-send-transaction";
import { parseTransactionError } from "../../../lib/errors";
import { ellipsify } from "../../../lib/explorer";
import {
  createCheckinPayload,
  generateTicketKey,
  loadTicketKey,
  saveTicketKey,
  type TicketKey,
} from "../../../lib/qr";
import {
  eventPhase,
  formatTimestamp,
  useEvent,
  useEventSummary,
  useTicket,
} from "../../../lib/event-pool";
import { EventStatus } from "../../../generated/event_pool";

const primaryBtn =
  "flex h-12 w-full items-center justify-center rounded-xl bg-primary text-sm font-medium text-primary-foreground disabled:opacity-60";
const secondaryBtn =
  "flex h-12 items-center justify-center rounded-xl border border-border bg-card px-4 text-sm font-medium transition hover:bg-cream";

function Notice({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
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

export function TicketView({ pda }: { pda: string }) {
  const { getExplorerUrl } = useCluster();
  const { wallet, signer, status } = useWallet();
  const member = wallet?.account.address;

  const { event } = useEvent(pda);
  const { summary } = useEventSummary(pda);
  // Polls every 5 s so a check-in at the door flips this screen to green.
  const {
    ticket,
    ticketAddress,
    mutate: mutateTicket,
  } = useTicket(pda, member, 5_000);
  const { send } = useSendTransaction();

  // localStorage is client-only: load after mount (and whenever the wallet changes).
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  const [recoveredKey, setRecoveredKey] = useState<TicketKey | null>(null);
  const storedKey = useMemo<TicketKey | null | undefined>(() => {
    if (!mounted) return undefined;
    if (recoveredKey) return recoveredKey;
    return member ? loadTicketKey(pda, member) : null;
  }, [mounted, recoveredKey, pda, member]);

  const [recovering, setRecovering] = useState(false);
  const [recoverError, setRecoverError] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const busy = useRef(false);

  // A stored secret only counts if it matches the key registered on-chain.
  const key =
    storedKey && ticket && storedKey.publicKey === ticket.ticketKey
      ? storedKey
      : null;

  const getPayload = useCallback(
    () =>
      createCheckinPayload({
        event: pda,
        member: member as string,
        secretKey: (key as TicketKey).secretKey,
      }),
    [pda, member, key]
  );

  const recover = async () => {
    if (busy.current || !signer || !member || !ticketAddress) return;
    busy.current = true;
    setRecovering(true);
    setRecoverError(null);
    try {
      const fresh = generateTicketKey();
      const signature = await send({
        instructions: [
          getRotateTicketKeyInstruction({
            member: signer,
            event: pda as Address,
            ticket: ticketAddress,
            newKey: fresh.publicKey as Address,
          }),
        ],
      });
      const saved = saveTicketKey(pda, member, fresh);
      setSaveFailed(!saved);
      setRecoveredKey(fresh);
      toast.success("Ticket recovered", {
        action: {
          label: "Explorer",
          onClick: () =>
            window.open(getExplorerUrl(`/tx/${signature}`), "_blank"),
        },
      });
      await mutateTicket();
    } catch (err) {
      setRecoverError(parseTransactionError(err));
    } finally {
      busy.current = false;
      setRecovering(false);
    }
  };

  const back = (
    <Link
      href={`/events/${pda}`}
      className="mb-4 inline-flex text-xs font-medium text-muted underline-offset-4 hover:text-foreground hover:underline"
    >
      &larr; Event
    </Link>
  );

  let body: React.ReactNode;

  if (status === "connecting") {
    body = <p className="text-sm text-muted">Connecting wallet...</p>;
  } else if (!wallet) {
    body = (
      <Notice title="Connect your wallet">
        <p>Connect the wallet you used to join to see your ticket.</p>
      </Notice>
    );
  } else if (event === undefined || ticket === undefined) {
    body = (
      <div className="h-64 animate-pulse rounded-2xl bg-card" aria-hidden />
    );
  } else if (event === null) {
    body = (
      <Notice title="Event not found">
        <p>There is no event at this address on the selected cluster.</p>
      </Notice>
    );
  } else if (ticket === null) {
    body = (
      <Notice title="No ticket for this wallet">
        <p>
          {ellipsify(wallet.account.address)} does not hold a ticket for this
          event. If you joined with another wallet, switch to it.
        </p>
        <Link href={`/events/${pda}`} className={primaryBtn}>
          Go to event
        </Link>
      </Notice>
    );
  } else if (ticket.checkedIn) {
    body = (
      <div
        role="status"
        className="rounded-3xl bg-green-600 p-8 text-center text-white"
      >
        <div aria-hidden className="text-6xl">
          &#10003;
        </div>
        <h2 className="mt-3 text-2xl font-bold">You are checked in</h2>
        {ticket.checkedInAt > 0n && (
          <p className="mt-1 text-sm opacity-90">
            {formatTimestamp(ticket.checkedInAt)}
          </p>
        )}
        <p className="mt-3 text-sm opacity-90">
          Enjoy the event. If you check in you can claim your share of the pool
          after it ends.
        </p>
        <Link
          href={`/events/${pda}/claim`}
          className="mt-5 inline-flex h-11 items-center rounded-xl bg-white px-5 text-sm font-medium text-green-700"
        >
          Claim page
        </Link>
      </div>
    );
  } else if (event.status === EventStatus.Cancelled) {
    body = (
      <Notice title="This event was cancelled">
        <p>Your entry fee can be refunded.</p>
        <Link href={`/events/${pda}/claim`} className={primaryBtn}>
          Refund
        </Link>
      </Notice>
    );
  } else if (
    event.status === EventStatus.Ended ||
    eventPhase(event) === "over"
  ) {
    body = (
      <Notice title="This event is over">
        <p>Check-in is closed. You did not check in, so there is no payout.</p>
        <Link href={`/events/${pda}/claim`} className={secondaryBtn}>
          Claim page
        </Link>
      </Notice>
    );
  } else if (storedKey === undefined) {
    body = (
      <div className="h-64 animate-pulse rounded-2xl bg-card" aria-hidden />
    );
  } else if (!key) {
    body = (
      <Notice title="Ticket key not found on this device">
        <p>
          The secret that signs your QR code lives only in the browser you
          joined with. Recover your ticket to create a new one on this device
          (one wallet approval). Any older device stops working.
        </p>
        <button
          type="button"
          onClick={() => void recover()}
          disabled={recovering}
          className={primaryBtn}
        >
          {recovering ? "Confirm in your wallet..." : "Recover ticket"}
        </button>
        {recoverError && (
          <p role="alert" className="text-destructive">
            {recoverError}
          </p>
        )}
      </Notice>
    );
  } else {
    body = (
      <div className="flex flex-col items-center">
        <QrDisplay getPayload={getPayload} size={288} />
        <p className="mt-3 text-center text-xs text-muted">
          Turn your screen brightness up and show this to the host. The code
          refreshes on its own, screenshots stop working.
        </p>
        {saveFailed && (
          <p role="alert" className="mt-3 text-center text-xs text-destructive">
            Your browser blocked storage, so this key will not survive a reload.
            You can recover again if that happens.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md">
      {back}
      <h1 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">
        {summary?.title ?? "Your ticket"}
      </h1>
      {member && (
        <p className="mt-1 mb-6 text-center font-mono text-xs text-muted">
          {ellipsify(member)}
        </p>
      )}
      {body}
    </div>
  );
}
