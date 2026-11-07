"use client";

import { toast } from "sonner";
import type { Address } from "@solana/kit";
import { getSettleVendorInstructionAsync } from "../generated/event_pool";
import { useCluster } from "./cluster-context";
import { useWallet } from "../lib/wallet/context";
import { useSendTransaction } from "../lib/hooks/use-send-transaction";
import { sponsorshipErrorMessage } from "../lib/event-pool/vendor-errors";

/**
 * `settle_vendor`: anyone may sign (they only pay the tx fee); the vault pays the vendor.
 * Only possible once the event has Ended and the sponsorship is Delivered.
 */
export function SettleVendorButton({
  event,
  sponsorship,
  vendor,
  eventEnded,
  onDone,
  className,
}: {
  event: string;
  sponsorship: string;
  vendor: string;
  eventEnded: boolean;
  onDone?: () => void | Promise<unknown>;
  className?: string;
}) {
  const { getExplorerUrl } = useCluster();
  const { signer } = useWallet();
  const { send, isSending } = useSendTransaction();

  const settle = async () => {
    if (!signer) return;
    try {
      const sig = await send({
        instructions: [
          await getSettleVendorInstructionAsync({
            payer: signer,
            event: event as Address,
            sponsorship: sponsorship as Address,
            vendor: vendor as Address,
          }),
        ],
      });
      toast.success("Vendor paid", {
        action: {
          label: "Explorer",
          onClick: () => window.open(getExplorerUrl(`/tx/${sig}`), "_blank"),
        },
      });
      await onDone?.();
    } catch (err) {
      toast.error(sponsorshipErrorMessage(err));
    }
  };

  const disabled = !signer || !eventEnded || isSending;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => void settle()}
      title={
        eventEnded
          ? undefined
          : "Available to anyone once the host has ended the event"
      }
      className={
        className ??
        "h-9 shrink-0 cursor-pointer rounded-lg border border-border px-3 text-xs font-medium hover:bg-cream disabled:cursor-not-allowed disabled:opacity-60"
      }
    >
      {isSending ? "Confirm in wallet..." : "Settle payment"}
    </button>
  );
}
