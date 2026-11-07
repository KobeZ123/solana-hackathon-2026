"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { Address } from "@solana/kit";
import {
  EventStatus,
  getCancelEventInstruction,
  getEndEventInstructionAsync,
  getWithdrawHostInstructionAsync,
} from "../../../generated/event_pool";
import { ConfirmDialog } from "../../../components/confirm-dialog";
import { useCluster } from "../../../components/cluster-context";
import { useWallet } from "../../../lib/wallet/context";
import { useSendTransaction } from "../../../lib/hooks/use-send-transaction";
import { parseTransactionError } from "../../../lib/errors";
import { ellipsify } from "../../../lib/explorer";
import {
  bpsToPercent,
  computePayout,
  eventStatusLabel,
  formatSol,
  formatTimestamp,
  hostActions,
  settledPayout,
  useEvent,
  useEventTickets,
  usePoolBalance,
  type PayoutBreakdown,
} from "../../../lib/event-pool";

type Action = "cancel" | "end" | "withdraw";

function Notice({ title, body }: { title: string; body: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-xl">
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
        Host dashboard
      </h1>
      <div className="mt-6 rounded-2xl border border-border-low bg-card p-6">
        <p className="text-sm font-medium">{title}</p>
        <div className="mt-1 text-sm text-muted">{body}</div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border-low bg-card p-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-base font-semibold">{value}</dd>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

const linkBtn =
  "flex h-12 items-center justify-center rounded-xl border border-border bg-card px-4 text-sm font-medium transition hover:bg-cream";
const actionBtn =
  "flex h-12 w-full cursor-pointer items-center justify-center rounded-xl bg-primary text-sm font-medium text-primary-foreground disabled:opacity-60";

export function HostDashboard({ pda }: { pda: string }) {
  const { cluster, getExplorerUrl } = useCluster();
  const { wallet, signer } = useWallet();
  const { send, isSending } = useSendTransaction();

  const { event, isLoading, mutate: mutateEvent } = useEvent(pda);
  const { vaultLamports, pool, mutate: mutatePool } = usePoolBalance(pda);
  const { tickets, mutate: mutateTickets } = useEventTickets(pda);

  const [confirming, setConfirming] = useState<Action | null>(null);
  const [lastTx, setLastTx] = useState<string | null>(null);
  // Ticking clock so Cancel/End appear at the right moment without a reload.
  const [nowSecs, setNowSecs] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(
      () => setNowSecs(Math.floor(Date.now() / 1000)),
      5_000
    );
    return () => clearInterval(id);
  }, []);

  if (isLoading || event === undefined) {
    return (
      <Notice title="Loading event..." body="Reading the event account." />
    );
  }
  if (event === null) {
    return (
      <Notice
        title="Event not found"
        body={`No event account at ${ellipsify(pda)} on ${cluster}. Check the cluster selector.`}
      />
    );
  }
  if (!wallet || !signer) {
    return (
      <Notice
        title="Connect your wallet"
        body="Only the host can open the dashboard. Connect the host wallet to continue."
      />
    );
  }
  if (wallet.account.address !== event.host) {
    return (
      <Notice
        title="Host only"
        body="The connected wallet is not this event's host."
      />
    );
  }

  const actions = hostActions(event, nowSecs);
  const settled = event.status !== EventStatus.Open;
  const payout: PayoutBreakdown | null =
    event.status === EventStatus.Ended
      ? settledPayout(event)
      : event.status === EventStatus.Open && vaultLamports !== undefined
        ? computePayout({
            vaultLamports,
            payoutBps: event.payoutBps,
            checkedIn: event.checkedIn,
            approvedSponsorTotal: event.approvedSponsorTotal,
          })
        : null;

  const run = async (action: Action) => {
    const event_ = pda as Address;
    try {
      const instruction =
        action === "cancel"
          ? getCancelEventInstruction({ host: signer, event: event_ })
          : action === "end"
            ? await getEndEventInstructionAsync({ host: signer, event: event_ })
            : await getWithdrawHostInstructionAsync({
                host: signer,
                event: event_,
              });
      const sig = await send({ instructions: [instruction] });
      setLastTx(sig);
      setConfirming(null);
      toast.success(
        action === "cancel"
          ? "Event cancelled"
          : action === "end"
            ? "Event ended"
            : "Host budget withdrawn",
        {
          action: {
            label: "Explorer",
            onClick: () => window.open(getExplorerUrl(`/tx/${sig}`), "_blank"),
          },
        }
      );
      await Promise.all([mutateEvent(), mutatePool(), mutateTickets()]);
    } catch (err) {
      setConfirming(null);
      toast.error(parseTransactionError(err));
    }
  };

  const sorted = [...(tickets ?? [])].sort(
    (a, b) =>
      Number(b.data.checkedIn) - Number(a.data.checkedIn) ||
      a.data.member.localeCompare(b.data.member)
  );

  return (
    <div className="mx-auto w-full max-w-xl space-y-5">
      <div>
        <Link
          href={`/events/${pda}`}
          className="mb-4 inline-flex text-xs font-medium text-muted underline-offset-4 hover:text-foreground hover:underline"
        >
          &larr; Event
        </Link>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Host dashboard
        </h1>
        <p className="mt-1 text-sm text-muted">
          {eventStatusLabel(event.status)} &middot;{" "}
          {formatTimestamp(event.startTs)} to {formatTimestamp(event.endTs)}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-3">
        <Stat
          label="Pool"
          value={`${formatSol(pool ?? 0n)} SOL`}
          hint={
            settled
              ? "Live vault balance"
              : "Entry fees held, minus the vault rent floor"
          }
        />
        <Stat
          label="Tickets sold"
          value={`${event.ticketsSold} / ${event.capacity}`}
        />
        <Stat
          label="Checked in"
          value={`${event.checkedIn} / ${event.ticketsSold}`}
        />
        <Stat
          label="Attendee payout"
          value={`${bpsToPercent(event.payoutBps)}%`}
        />
        {payout && (
          <>
            <Stat
              label={settled ? "Attendee pool" : "Attendee pool (preview)"}
              value={`${formatSol(payout.attendeePool)} SOL`}
              hint={
                event.checkedIn > 0
                  ? `${formatSol(payout.perAttendee, 6)} SOL each`
                  : "Rolls to you if nobody checks in"
              }
            />
            <Stat
              label={settled ? "Host budget" : "Host budget (preview)"}
              value={`${formatSol(payout.hostBudget)} SOL`}
              hint={
                settled
                  ? undefined
                  : "Final amount is set when you end the event"
              }
            />
          </>
        )}
      </dl>

      <section className="rounded-2xl border border-border-low bg-card p-5">
        <h2 className="text-sm font-semibold">Actions</h2>
        <div className="mt-3 space-y-3">
          {actions.cancel && (
            <div>
              <button
                type="button"
                disabled={isSending}
                onClick={() => setConfirming("cancel")}
                className={actionBtn}
              >
                Cancel event
              </button>
              <p className="mt-1 text-xs text-muted">
                Only possible before the start. Members can then refund their
                entry fee.
              </p>
            </div>
          )}
          {actions.end && (
            <div>
              <button
                type="button"
                disabled={isSending}
                onClick={() => setConfirming("end")}
                className={actionBtn}
              >
                End event
              </button>
              <p className="mt-1 text-xs text-muted">
                Locks the payout split. Checked-in attendees can then claim.
              </p>
            </div>
          )}
          {actions.withdraw && payout && (
            <div>
              <button
                type="button"
                disabled={isSending}
                onClick={() => setConfirming("withdraw")}
                className={actionBtn}
              >
                Withdraw {formatSol(payout.hostWithdraw, 9)} SOL
              </button>
              <p className="mt-1 text-xs text-muted">
                Host budget{payout.dust > 0n ? " plus attendee-split dust" : ""}
                {event.approvedSponsorTotal > 0n
                  ? ", minus approved sponsorships"
                  : ""}
                .
              </p>
            </div>
          )}
          {event.status === EventStatus.Open &&
            !actions.cancel &&
            !actions.end && (
              <p className="text-sm text-muted">
                The event is live. You can end it after{" "}
                {formatTimestamp(event.endTs)}.
              </p>
            )}
          {event.status === EventStatus.Ended && event.hostWithdrawn && (
            <p className="text-sm text-muted">Host budget withdrawn.</p>
          )}
          {event.status === EventStatus.Cancelled && (
            <p className="text-sm text-muted">
              Event cancelled. Members can refund from their claim page.
            </p>
          )}
          {lastTx && (
            <a
              href={getExplorerUrl(`/tx/${lastTx}`)}
              target="_blank"
              rel="noreferrer"
              className="inline-block text-xs underline"
            >
              Last transaction on Explorer
            </a>
          )}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Link href={`/events/${pda}/scan`} className={linkBtn}>
            Open scanner
          </Link>
          <Link href={`/events/${pda}`} className={linkBtn}>
            Public page
          </Link>
        </div>
      </section>

      <section className="rounded-2xl border border-border-low bg-card p-5">
        <h2 className="text-sm font-semibold">
          Attendees {tickets ? `(${tickets.length})` : ""}
        </h2>
        {tickets === undefined ? (
          <p className="mt-3 text-sm text-muted">Loading tickets...</p>
        ) : tickets.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Nobody has joined yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border-low">
            {sorted.map((t) => (
              <li
                key={t.address}
                className="flex items-center justify-between gap-3 py-2 text-xs"
              >
                <a
                  href={getExplorerUrl(`/address/${t.data.member}`)}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono underline-offset-2 hover:underline"
                >
                  {ellipsify(t.data.member, 6)}
                </a>
                <span className="flex gap-1.5">
                  <Badge on={t.data.checkedIn} label="Checked in" />
                  <Badge on={t.data.claimed} label="Claimed" />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={confirming === "cancel"}
        title="Cancel this event?"
        confirmLabel="Cancel event"
        destructive
        busy={isSending}
        onCancel={() => setConfirming(null)}
        onConfirm={() => void run("cancel")}
      >
        This cannot be undone. The event will close to new members and everyone
        who joined can refund their entry fee ({event.ticketsSold} ticket
        {event.ticketsSold === 1 ? "" : "s"} sold).
      </ConfirmDialog>
      <ConfirmDialog
        open={confirming === "end"}
        title="End this event?"
        confirmLabel="End event"
        destructive
        busy={isSending}
        onCancel={() => setConfirming(null)}
        onConfirm={() => void run("end")}
      >
        This cannot be undone. The pool is split now:{" "}
        {bpsToPercent(event.payoutBps)}% goes to the {event.checkedIn}{" "}
        checked-in attendee
        {event.checkedIn === 1 ? "" : "s"}
        {payout ? ` (about ${formatSol(payout.perAttendee, 6)} SOL each)` : ""},
        the rest is yours. Nobody can check in afterwards.
      </ConfirmDialog>
      <ConfirmDialog
        open={confirming === "withdraw"}
        title="Withdraw your budget?"
        confirmLabel="Withdraw"
        destructive
        busy={isSending}
        onCancel={() => setConfirming(null)}
        onConfirm={() => void run("withdraw")}
      >
        {payout ? (
          <>
            You will receive exactly{" "}
            <strong>{formatSol(payout.hostWithdraw, 9)} SOL</strong>. This can
            only be done once.
          </>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}

function Badge({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 ${
        on
          ? "bg-green-600/15 text-green-700 dark:text-green-400"
          : "bg-cream text-muted"
      }`}
    >
      {on ? label : `Not ${label.toLowerCase()}`}
    </span>
  );
}
