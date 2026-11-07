"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { Address, TransactionSigner } from "@solana/kit";
import {
  EventStatus,
  SponsorshipStatus,
  getApproveSponsorshipInstructionAsync,
  getRejectSponsorshipInstruction,
  getReleaseSponsorshipInstructionAsync,
  type Event,
} from "../../../generated/event_pool";
import { ConfirmDialog } from "../../../components/confirm-dialog";
import { SettleVendorButton } from "../../../components/settle-vendor-button";
import { useCluster } from "../../../components/cluster-context";
import { useAuth } from "../../../lib/hooks/use-auth";
import { useSendTransaction } from "../../../lib/hooks/use-send-transaction";
import { ellipsify } from "../../../lib/explorer";
import {
  budgetCheck,
  formatSol,
  sponsorshipErrorMessage,
  sponsorshipStatusLabel,
  useEventSponsorships,
  useOffers,
  type SponsorshipRecord,
} from "../../../lib/event-pool";

type Pending = {
  kind: "approve" | "reject" | "release";
  sp: SponsorshipRecord;
};

const ORDER: Record<SponsorshipStatus, number> = {
  [SponsorshipStatus.Proposed]: 0,
  [SponsorshipStatus.Approved]: 1,
  [SponsorshipStatus.Delivered]: 2,
  [SponsorshipStatus.Paid]: 3,
  [SponsorshipStatus.Rejected]: 4,
};

const smallBtn =
  "h-9 shrink-0 cursor-pointer rounded-lg border border-border px-3 text-xs font-medium hover:bg-cream disabled:cursor-not-allowed disabled:opacity-60";

/** Host dashboard: sponsorship proposals from vendors (approve / reject / release / settle). */
export function SponsorshipInbox({
  pda,
  event,
  pool,
  signer,
  onChanged,
}: {
  pda: string;
  event: Event;
  /** Live pool (vault minus rent floor); undefined while loading. */
  pool: bigint | undefined;
  signer: TransactionSigner;
  onChanged: () => Promise<unknown>;
}) {
  const { getExplorerUrl } = useCluster();
  const { send, isSending } = useSendTransaction();
  const { isAuthenticated, signIn, isSigningIn } = useAuth();
  const { sponsorships, mutate } = useEventSponsorships(pda);
  const { offers, mutate: mutateOffers } = useOffers(pda);
  const [pending, setPending] = useState<Pending | null>(null);

  const open = event.status === EventStatus.Open;
  const ended = event.status === EventStatus.Ended;
  const offerOf = (vendor: string) => offers?.find((o) => o.vendor === vendor);

  const sorted = [...(sponsorships ?? [])].sort(
    (a, b) =>
      ORDER[a.data.status] - ORDER[b.data.status] ||
      a.data.vendor.localeCompare(b.data.vendor)
  );

  const cap =
    pool === undefined
      ? null
      : budgetCheck({
          pool,
          payoutBps: event.payoutBps,
          approvedSponsorTotal: event.approvedSponsorTotal,
          amount: 0n,
        });

  const refresh = async () => {
    await Promise.all([mutate(), onChanged()]);
  };

  const run = async (p: Pending) => {
    const common = {
      host: signer,
      event: pda as Address,
      sponsorship: p.sp.address,
    };
    try {
      const instruction =
        p.kind === "approve"
          ? await getApproveSponsorshipInstructionAsync(common)
          : p.kind === "reject"
            ? getRejectSponsorshipInstruction(common)
            : await getReleaseSponsorshipInstructionAsync(common);
      const sig = await send({ instructions: [instruction] });
      setPending(null);
      toast.success(
        p.kind === "approve"
          ? "Sponsorship approved"
          : p.kind === "reject"
            ? "Sponsorship rejected"
            : "Reservation released",
        {
          action: {
            label: "Explorer",
            onClick: () => window.open(getExplorerUrl(`/tx/${sig}`), "_blank"),
          },
        }
      );
      await refresh();
    } catch (err) {
      setPending(null);
      toast.error(sponsorshipErrorMessage(err));
    }
  };

  const pendingName = pending
    ? (offerOf(pending.sp.data.vendor)?.vendorProfile?.name ??
      ellipsify(pending.sp.data.vendor))
    : "";

  return (
    <section className="rounded-2xl border border-border-low bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-semibold">
          Sponsorships {sponsorships ? `(${sponsorships.length})` : ""}
        </h2>
        {!isAuthenticated && (
          <button
            type="button"
            disabled={isSigningIn}
            onClick={() => void signIn().then(() => mutateOffers())}
            className={smallBtn}
          >
            {isSigningIn ? "Signing in..." : "Sign in to load offers"}
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-muted">
        Vendors are paid out of your budget, never the attendee pool.
        {cap && open
          ? ` Approved ${formatSol(cap.approved, 6)} of ${formatSol(cap.cap, 6)} SOL possible now (${formatSol(cap.remaining, 6)} SOL remaining).`
          : ""}
        {ended
          ? ` ${formatSol(event.approvedSponsorTotal, 6)} SOL is still reserved for unpaid vendors.`
          : ""}
      </p>

      {sponsorships === undefined ? (
        <p className="mt-3 text-sm text-muted">Loading sponsorships...</p>
      ) : sorted.length === 0 ? (
        <p className="mt-3 text-sm text-muted">
          No vendor has proposed a sponsorship yet.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border-low">
          {sorted.map((sp) => {
            const offer = offerOf(sp.data.vendor);
            const check =
              pool === undefined
                ? null
                : budgetCheck({
                    pool,
                    payoutBps: event.payoutBps,
                    approvedSponsorTotal: event.approvedSponsorTotal,
                    amount: sp.data.amount,
                  });
            const status = sp.data.status;
            return (
              <li key={sp.address} className="space-y-2 py-3 text-xs">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {offer?.vendorProfile?.name ??
                        ellipsify(sp.data.vendor, 6)}
                    </p>
                    <a
                      href={getExplorerUrl(`/address/${sp.data.vendor}`)}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-muted underline-offset-2 hover:underline"
                    >
                      {ellipsify(sp.data.vendor, 6)}
                    </a>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold">
                      {formatSol(sp.data.amount, 6)} SOL
                    </p>
                    <span className="rounded-full bg-cream px-2 py-0.5 text-muted">
                      {sponsorshipStatusLabel(status)}
                    </span>
                  </div>
                </div>
                {offer?.offerText ? (
                  <p className="whitespace-pre-wrap rounded-lg bg-cream p-2 text-foreground/80">
                    {offer.offerText}
                    {!offer.offerVerified && (
                      <span className="mt-1 block text-destructive">
                        Text does not match the on-chain offer hash.
                      </span>
                    )}
                  </p>
                ) : (
                  <p className="text-muted">
                    {isAuthenticated
                      ? "The vendor has not published the offer text."
                      : "Sign in to read the offer text."}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  {status === SponsorshipStatus.Proposed && open && (
                    <>
                      <button
                        type="button"
                        disabled={isSending || (check?.exceeds ?? false)}
                        onClick={() => setPending({ kind: "approve", sp })}
                        className={smallBtn}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={isSending}
                        onClick={() => setPending({ kind: "reject", sp })}
                        className={smallBtn}
                      >
                        Reject
                      </button>
                      {check?.exceeds && (
                        <span className="text-destructive">
                          Over the remaining budget (
                          {formatSol(check.remaining, 6)} SOL).
                        </span>
                      )}
                    </>
                  )}
                  {status === SponsorshipStatus.Approved && ended && (
                    <button
                      type="button"
                      disabled={isSending}
                      onClick={() => setPending({ kind: "release", sp })}
                      className={smallBtn}
                    >
                      Release reservation
                    </button>
                  )}
                  {status === SponsorshipStatus.Approved && open && (
                    <span className="text-muted">
                      Waiting for delivery at the scanner.
                    </span>
                  )}
                  {status === SponsorshipStatus.Delivered && (
                    <>
                      <SettleVendorButton
                        event={pda}
                        sponsorship={sp.address}
                        vendor={sp.data.vendor}
                        eventEnded={ended}
                        onDone={refresh}
                      />
                      {!ended && (
                        <span className="text-muted">
                          Payable by anyone once you end the event.
                        </span>
                      )}
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={pending?.kind === "approve"}
        title="Approve this sponsorship?"
        confirmLabel="Approve"
        busy={isSending}
        onCancel={() => setPending(null)}
        onConfirm={() => pending && void run(pending)}
      >
        {pending && (
          <>
            {formatSol(pending.sp.data.amount, 6)} SOL is reserved from your
            budget for {pendingName}. It is paid to the vendor after you confirm
            delivery and the event ends. Attendee payouts are not affected.
          </>
        )}
      </ConfirmDialog>
      <ConfirmDialog
        open={pending?.kind === "reject"}
        title="Reject this sponsorship?"
        confirmLabel="Reject"
        destructive
        busy={isSending}
        onCancel={() => setPending(null)}
        onConfirm={() => pending && void run(pending)}
      >
        {pendingName} will not be able to propose again for this event.
      </ConfirmDialog>
      <ConfirmDialog
        open={pending?.kind === "release"}
        title="Release this reservation?"
        confirmLabel="Release"
        destructive
        busy={isSending}
        onCancel={() => setPending(null)}
        onConfirm={() => pending && void run(pending)}
      >
        {pending && (
          <>
            {pendingName} was approved but delivery was never confirmed. The{" "}
            {formatSol(pending.sp.data.amount, 6)} SOL goes back to your budget
            and the sponsorship is closed.
          </>
        )}
      </ConfirmDialog>
    </section>
  );
}
