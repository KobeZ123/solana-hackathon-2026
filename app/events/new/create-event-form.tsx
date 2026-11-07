"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { getCreateEventInstruction } from "../../generated/event_pool";
import { useCluster } from "../../components/cluster-context";
import { useWallet } from "../../lib/wallet/context";
import { useAuth } from "../../lib/hooks/use-auth";
import { useBalance } from "../../lib/hooks/use-balance";
import { useSendTransaction } from "../../lib/hooks/use-send-transaction";
import { parseTransactionError } from "../../lib/errors";
import { ApiError } from "../../lib/api-client";
import { metadataHashBytes } from "../../lib/metadata";
import {
  PAYOUT_PCT_DEFAULT,
  PAYOUT_PCT_MAX,
  PAYOUT_PCT_MIN,
  deriveEventAddress,
  deriveVaultAddress,
  formatSol,
  postEvent,
  validateCreateEventForm,
  type CreateEventFormValues,
  type FormErrors,
  type PostEventBody,
} from "../../lib/event-pool";

const INITIAL: CreateEventFormValues = {
  title: "",
  summary: "",
  location: "",
  description: "",
  coverUrl: "",
  feeSol: "0.1",
  capacity: "50",
  start: "",
  end: "",
  payoutPercent: PAYOUT_PCT_DEFAULT,
  visibility: "public",
};

/** Rough cost of two rent-exempt accounts plus fees; used only for a low-balance hint. */
const LOW_BALANCE_LAMPORTS = 10_000_000n;

const inputClass =
  "w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm outline-none transition focus:border-ring";

function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

type Pending = { pda: string; body: PostEventBody; signature: string };

export function CreateEventForm() {
  const router = useRouter();
  const { wallet, signer } = useWallet();
  const { cluster, getExplorerUrl } = useCluster();
  const { send } = useSendTransaction();
  const { ensureToken } = useAuth();
  const { lamports: balance } = useBalance(wallet?.account.address);

  const [values, setValues] = useState<CreateEventFormValues>(INITIAL);
  const [errors, setErrors] = useState<FormErrors>({});
  const [step, setStep] = useState<"idle" | "chain" | "api">("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const busy = useRef(false);

  const set = <K extends keyof CreateEventFormValues>(
    key: K,
    value: CreateEventFormValues[K]
  ) => setValues((v) => ({ ...v, [key]: value }));

  const lowBalance =
    wallet !== undefined && balance !== null && balance < LOW_BALANCE_LAMPORTS;

  const registerMetadata = async (p: Pending) => {
    setStep("api");
    setSubmitError(null);
    try {
      await ensureToken();
      try {
        await postEvent(p.body);
      } catch (err) {
        // Already registered by an earlier attempt: treat as success.
        if (!(err instanceof ApiError && err.status === 409)) throw err;
      }
      setPending(null);
      setCreated(p.pda);
      toast.success("Event published", {
        action: {
          label: "View",
          onClick: () => router.push(`/events/${p.pda}`),
        },
      });
    } catch (err) {
      setPending(p);
      setSubmitError(
        `The event is on-chain, but saving its details failed: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    } finally {
      setStep("idle");
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy.current || !wallet || !signer) return;
    const result = validateCreateEventForm(values);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setSubmitError(null);
    busy.current = true;
    const v = result.value;

    try {
      setStep("chain");
      const eventId = BigInt(Date.now());
      const host = wallet.account.address;
      const event = await deriveEventAddress(host, eventId);
      const vault = await deriveVaultAddress(event);
      // Hash exactly the object the API will recompute.
      const metadata = {
        title: v.title,
        summary: v.summary,
        coverUrl: v.coverUrl,
        details: v.details,
      };
      const metadataHash = await metadataHashBytes(metadata);

      const signature = await send({
        instructions: [
          getCreateEventInstruction({
            host: signer,
            event,
            vault,
            eventId,
            entryFee: v.entryFee,
            capacity: v.capacity,
            startTs: v.startTs,
            endTs: v.endTs,
            payoutBps: v.payoutBps,
            metadataHash,
          }),
        ],
      });
      toast.success("Event created on-chain", {
        action: {
          label: "Explorer",
          onClick: () =>
            window.open(getExplorerUrl(`/tx/${signature}`), "_blank"),
        },
      });
      await registerMetadata({
        pda: event,
        signature,
        body: { ...metadata, eventPda: event, visibility: v.visibility },
      });
    } catch (err) {
      setSubmitError(parseTransactionError(err));
      setStep("idle");
    } finally {
      busy.current = false;
    }
  };

  if (created) {
    const url =
      typeof window === "undefined"
        ? `/events/${created}`
        : `${window.location.origin}/events/${created}`;
    return (
      <div className="rounded-2xl border border-border-low bg-card p-6">
        <h2 className="text-lg font-semibold">Your event is live</h2>
        <p className="mt-1 text-sm text-foreground/60">
          Share this link. Members connect a wallet and join from there.
        </p>
        <div className="mt-4 flex gap-2">
          <input
            readOnly
            value={url}
            aria-label="Shareable event link"
            className={`${inputClass} font-mono text-xs`}
            onFocus={(e) => e.currentTarget.select()}
          />
          <button
            type="button"
            className="shrink-0 rounded-xl border border-border px-3 text-sm font-medium transition hover:bg-cream"
            onClick={() => {
              void navigator.clipboard
                ?.writeText(url)
                .then(() => toast.success("Link copied"))
                .catch(() =>
                  toast.error("Could not copy, select the link instead")
                );
            }}
          >
            Copy
          </button>
        </div>
        <Link
          href={`/events/${created}`}
          className="mt-4 inline-flex h-11 items-center rounded-xl bg-primary px-5 text-sm font-medium text-primary-foreground"
        >
          Open event page
        </Link>
      </div>
    );
  }

  const submitting = step !== "idle";

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <Field label="Title" htmlFor="title" error={errors.title}>
        <input
          id="title"
          className={inputClass}
          value={values.title}
          maxLength={200}
          onChange={(e) => set("title", e.target.value)}
          placeholder="Rooftop Meetup"
        />
      </Field>

      <Field
        label="Summary"
        htmlFor="summary"
        error={errors.summary}
        hint="Public. Shown on the event list."
      >
        <textarea
          id="summary"
          rows={2}
          className={inputClass}
          value={values.summary}
          onChange={(e) => set("summary", e.target.value)}
        />
      </Field>

      <Field
        label="Location"
        htmlFor="location"
        error={errors.location}
        hint="Gated: only ticket holders and you can see this."
      >
        <input
          id="location"
          className={inputClass}
          value={values.location}
          onChange={(e) => set("location", e.target.value)}
        />
      </Field>

      <Field
        label="Details"
        htmlFor="description"
        error={errors.description}
        hint="Gated: schedule, links, what to bring."
      >
        <textarea
          id="description"
          rows={4}
          className={inputClass}
          value={values.description}
          onChange={(e) => set("description", e.target.value)}
        />
      </Field>

      <Field
        label="Cover image URL (optional)"
        htmlFor="coverUrl"
        error={errors.coverUrl}
      >
        <input
          id="coverUrl"
          inputMode="url"
          className={inputClass}
          value={values.coverUrl}
          onChange={(e) => set("coverUrl", e.target.value)}
          placeholder="https://"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Entry fee (SOL)"
          htmlFor="fee"
          error={errors.feeSol}
          hint="Minimum 0.001"
        >
          <input
            id="fee"
            inputMode="decimal"
            className={inputClass}
            value={values.feeSol}
            onChange={(e) => set("feeSol", e.target.value)}
          />
        </Field>
        <Field label="Capacity" htmlFor="capacity" error={errors.capacity}>
          <input
            id="capacity"
            inputMode="numeric"
            className={inputClass}
            value={values.capacity}
            onChange={(e) => set("capacity", e.target.value)}
          />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Starts" htmlFor="start" error={errors.start}>
          <input
            id="start"
            type="datetime-local"
            className={inputClass}
            value={values.start}
            onChange={(e) => set("start", e.target.value)}
          />
        </Field>
        <Field label="Ends" htmlFor="end" error={errors.end}>
          <input
            id="end"
            type="datetime-local"
            className={inputClass}
            value={values.end}
            onChange={(e) => set("end", e.target.value)}
          />
        </Field>
      </div>

      <Field
        label={`Attendee payout: ${values.payoutPercent}%`}
        htmlFor="payout"
        error={errors.payoutPercent}
        hint="Share of the pool split among attendees who check in. Fixed once created. The rest is your budget."
      >
        <input
          id="payout"
          type="range"
          min={PAYOUT_PCT_MIN}
          max={PAYOUT_PCT_MAX}
          step={1}
          className="w-full accent-primary"
          value={values.payoutPercent}
          onChange={(e) => set("payoutPercent", Number(e.target.value))}
        />
      </Field>

      <Field
        label="Visibility"
        htmlFor="visibility"
        hint="Network only: shown in the feed and openable only by people who share an event with you. Details stay ticket-gated either way."
      >
        <select
          id="visibility"
          className={inputClass}
          value={values.visibility}
          onChange={(e) =>
            set("visibility", e.target.value as "public" | "network")
          }
        >
          <option value="public">Public</option>
          <option value="network">Network only</option>
        </select>
      </Field>

      {lowBalance && (
        <p className="rounded-xl border border-border bg-card p-3 text-xs text-muted">
          Your balance is {formatSol(balance ?? 0n)} SOL, which may not cover
          the account rent and fees.{" "}
          {cluster === "devnet" ? (
            <>
              Get free devnet SOL at{" "}
              <a
                className="underline"
                href="https://faucet.solana.com"
                target="_blank"
                rel="noreferrer"
              >
                faucet.solana.com
              </a>
              .
            </>
          ) : null}
        </p>
      )}

      {submitError && (
        <p role="alert" className="text-sm text-destructive">
          {submitError}
        </p>
      )}

      {pending ? (
        <button
          type="button"
          disabled={submitting}
          onClick={() => void registerMetadata(pending)}
          className="h-12 w-full rounded-xl bg-primary text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {step === "api" ? "Saving details..." : "Retry saving details"}
        </button>
      ) : (
        <button
          type="submit"
          disabled={submitting || !wallet}
          className="h-12 w-full rounded-xl bg-primary text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {!wallet
            ? "Connect a wallet to create"
            : step === "chain"
              ? "Confirm in your wallet..."
              : step === "api"
                ? "Saving details..."
                : "Create event"}
        </button>
      )}
    </form>
  );
}
