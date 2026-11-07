"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import type { Address } from "@solana/kit";
import {
  EventStatus,
  SponsorshipStatus,
  getProposeSponsorshipInstructionAsync,
  type Event,
} from "../../generated/event_pool";
import { useCluster } from "../../components/cluster-context";
import { useAuth } from "../../lib/hooks/use-auth";
import { useSendTransaction } from "../../lib/hooks/use-send-transaction";
import { useWallet } from "../../lib/wallet/context";
import { OFFER_TEXT_MAX, offerHashBytes } from "../../lib/offer";
import {
  formatSol,
  postOffer,
  solToLamports,
  sponsorshipErrorMessage,
  sponsorshipStatusLabel,
  useSponsorship,
  useVendorProfile,
} from "../../lib/event-pool";

const inputClass =
  "w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm outline-none transition focus:border-ring";
const primaryBtn =
  "flex h-12 w-full cursor-pointer items-center justify-center rounded-xl bg-primary text-sm font-medium text-primary-foreground disabled:opacity-60";
const secondaryBtn =
  "flex h-12 items-center justify-center rounded-xl border border-border bg-card px-4 text-sm font-medium transition hover:bg-cream";

/**
 * Event page card for a registered vendor: propose a sponsorship (amount + offer text)
 * or see the status of the existing one. Hidden for the host and for non-vendors.
 */
export function ProposeSponsorship({
  pda,
  event,
  vendor,
}: {
  pda: string;
  event: Event;
  vendor: string;
}) {
  const { getExplorerUrl } = useCluster();
  const { signer } = useWallet();
  const { send } = useSendTransaction();
  const { ensureToken } = useAuth();
  const { profile } = useVendorProfile(vendor);
  const { sponsorship, mutate } = useSponsorship(pda, vendor);

  const [amountSol, setAmountSol] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when the on-chain proposal landed but publishing the offer text failed.
  const [publishPending, setPublishPending] = useState(false);

  if (profile === undefined || sponsorship === undefined) return null;
  if (profile === null) {
    return (
      <section className="rounded-2xl border border-border-low bg-card p-5">
        <h2 className="text-sm font-semibold">Vendor?</h2>
        <p className="mt-1 text-xs text-muted">
          Register as a vendor to propose a sponsorship for this event.
        </p>
        <Link href="/vendor" className={`${secondaryBtn} mt-3`}>
          Become a vendor
        </Link>
      </section>
    );
  }

  const publish = async () => {
    await ensureToken();
    await postOffer(pda, text.trim());
    setPublishPending(false);
  };

  const submit = async () => {
    if (busy || !signer) return;
    const amount = solToLamports(amountSol);
    if (amount === null || amount === 0n) {
      setError("Enter an amount in SOL greater than 0.");
      return;
    }
    if (text.trim() === "") {
      setError("Describe your offer.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const sig = await send({
        instructions: [
          await getProposeSponsorshipInstructionAsync({
            vendor: signer,
            event: pda as Address,
            amount,
            offerHash: await offerHashBytes(text.trim()),
          }),
        ],
      });
      toast.success("Sponsorship proposed", {
        action: {
          label: "Explorer",
          onClick: () => window.open(getExplorerUrl(`/tx/${sig}`), "_blank"),
        },
      });
      await mutate();
      setPublishPending(true);
      await publish();
    } catch (err) {
      setError(
        err instanceof Error && err.name === "ApiError"
          ? `Proposed on-chain, but publishing the offer text failed: ${err.message}`
          : sponsorshipErrorMessage(err)
      );
    } finally {
      setBusy(false);
    }
  };

  const retryPublish = async () => {
    setBusy(true);
    setError(null);
    try {
      await publish();
      toast.success("Offer text published");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (sponsorship !== null) {
    const status = sponsorship.status;
    return (
      <section className="rounded-2xl border border-border-low bg-card p-5">
        <h2 className="text-sm font-semibold">Your sponsorship</h2>
        <p className="mt-1 text-sm">
          {formatSol(sponsorship.amount, 6)} SOL &middot;{" "}
          <span className="rounded-full bg-cream px-2 py-0.5 text-xs text-muted">
            {sponsorshipStatusLabel(status)}
          </span>
        </p>
        {publishPending && (
          <div className="mt-3 space-y-2">
            <p role="alert" className="text-xs text-destructive">
              {error ?? "The offer text has not been published yet."}
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void retryPublish()}
              className={primaryBtn}
            >
              Publish offer text
            </button>
          </div>
        )}
        <div className="mt-3 grid grid-cols-2 gap-2">
          {(status === SponsorshipStatus.Approved ||
            status === SponsorshipStatus.Delivered) && (
            <Link href={`/events/${pda}/vendor-pass`} className={secondaryBtn}>
              Vendor pass
            </Link>
          )}
          <Link href="/vendor" className={secondaryBtn}>
            Vendor page
          </Link>
        </div>
      </section>
    );
  }

  if (event.status !== EventStatus.Open) return null;

  return (
    <section className="rounded-2xl border border-border-low bg-card p-5">
      <h2 className="text-sm font-semibold">Sponsor this event</h2>
      <p className="mt-1 text-xs text-muted">
        Propose to supply goods or services. If the host approves and confirms
        your delivery, you are paid from their budget after the event ends.
      </p>
      <form
        className="mt-3 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="block text-xs font-medium">
          Amount requested (SOL)
          <input
            className={`${inputClass} mt-1`}
            value={amountSol}
            onChange={(e) => setAmountSol(e.target.value)}
            inputMode="decimal"
            placeholder="0.5"
          />
        </label>
        <label className="block text-xs font-medium">
          Your offer
          <textarea
            className={`${inputClass} mt-1`}
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={OFFER_TEXT_MAX}
            placeholder="50 tacos for the crowd at 8pm"
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy || !signer} className={primaryBtn}>
          {busy ? "Confirm in your wallet..." : "Propose sponsorship"}
        </button>
      </form>
    </section>
  );
}
