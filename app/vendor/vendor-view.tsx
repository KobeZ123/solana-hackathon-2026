"use client";

import Link from "next/link";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { toast } from "sonner";
import type { Address } from "@solana/kit";
import {
  EventStatus,
  SponsorshipStatus,
  getRegisterVendorInstructionAsync,
} from "../generated/event_pool";
import { SettleVendorButton } from "../components/settle-vendor-button";
import { useCluster } from "../components/cluster-context";
import { useWallet } from "../lib/wallet/context";
import { useAuth } from "../lib/hooks/use-auth";
import { useSendTransaction } from "../lib/hooks/use-send-transaction";
import { parseTransactionError } from "../lib/errors";
import { ellipsify } from "../lib/explorer";
import {
  generateVendorKey,
  loadVendorKey,
  saveVendorKey,
  type VendorKey,
} from "../lib/qr";
import {
  formatSol,
  postVendor,
  sponsorshipStatusLabel,
  useEventsByAddress,
  useVendorApiProfile,
  useVendorProfile,
  useVendorSponsorships,
} from "../lib/event-pool";

const inputClass =
  "w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm outline-none transition focus:border-ring";
const primaryBtn =
  "flex h-12 w-full cursor-pointer items-center justify-center rounded-xl bg-primary text-sm font-medium text-primary-foreground disabled:opacity-60";
const linkBtn =
  "flex h-9 items-center justify-center rounded-lg border border-border px-3 text-xs font-medium hover:bg-cream";

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-border-low bg-card p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function VendorView() {
  const { wallet, signer, status } = useWallet();
  const address = wallet?.account.address;
  const { getExplorerUrl } = useCluster();
  const { send } = useSendTransaction();
  const { ensureToken } = useAuth();

  const { profile, mutate: mutateProfile } = useVendorProfile(address);
  const { vendor: apiVendor, mutate: mutateApi } = useVendorApiProfile(address);
  const { sponsorships, mutate: mutateSponsorships } =
    useVendorSponsorships(address);
  const eventAddrs = (sponsorships ?? []).map((s) => s.data.event as string);
  const { events } = useEventsByAddress(eventAddrs);

  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  // Re-read storage when the wallet changes or after registering.
  const [savedKey, setSavedKey] = useState<VendorKey | null>(null);
  const storedKey =
    savedKey ?? (mounted && address ? loadVendorKey(address) : null);

  const [name, setName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveProfile = async () => {
    await ensureToken();
    await postVendor({
      name: name.trim(),
      logoUrl: logoUrl.trim() || undefined,
      description: description.trim() || undefined,
    });
    await mutateApi();
  };

  const submit = async () => {
    if (busy || !signer || !address) return;
    if (name.trim() === "") {
      setError("Enter a vendor name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (!profile) {
        // Reuse a stored key from a failed earlier attempt, otherwise make one.
        const key = storedKey ?? generateVendorKey();
        // Persist before sending: the secret must never be lost once on-chain.
        if (!saveVendorKey(address, key)) {
          toast.warning(
            "Browser storage is unavailable: the vendor key will be lost if you reload."
          );
        }
        setSavedKey(key);
        const sig = await send({
          instructions: [
            await getRegisterVendorInstructionAsync({
              vendor: signer,
              vendorKey: key.publicKey as Address,
            }),
          ],
        });
        toast.success("Registered as a vendor", {
          action: {
            label: "Explorer",
            onClick: () => window.open(getExplorerUrl(`/tx/${sig}`), "_blank"),
          },
        });
        await mutateProfile();
      }
      await saveProfile();
      toast.success("Vendor profile saved");
    } catch (err) {
      setError(
        err instanceof Error && err.name === "ApiError"
          ? `Registered on-chain, but saving the profile failed: ${err.message}`
          : parseTransactionError(err)
      );
    } finally {
      setBusy(false);
    }
  };

  if (status === "connecting") {
    return <p className="text-sm text-muted">Connecting wallet...</p>;
  }
  if (!wallet || !address) {
    return (
      <div className="mx-auto w-full max-w-xl space-y-4">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Vendor
        </h1>
        <p className="rounded-2xl border border-border-low bg-card p-5 text-sm text-muted">
          Connect your wallet to register as a vendor. Vendors
          propose sponsorships to events and get paid from the host&apos;s
          budget after delivering.
        </p>
      </div>
    );
  }

  const registered = profile !== null && profile !== undefined;
  const keyMatches =
    registered &&
    storedKey !== null &&
    storedKey.publicKey === profile.vendorKey;

  return (
    <div className="mx-auto w-full max-w-xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Vendor
        </h1>
        <p className="mt-1 text-sm text-muted">
          Supply food, drinks or services at an event. The host approves your
          offer, scans your pass when you deliver, and you are paid from their
          budget once the event ends.
        </p>
      </div>

      <Card title={registered ? "Your profile" : "Register as a vendor"}>
        {registered && (
          <dl className="mb-4 space-y-1 text-xs">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Wallet</dt>
              <dd className="font-mono">{ellipsify(address, 6)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Pass key on-chain</dt>
              <dd className="font-mono">{ellipsify(profile.vendorKey, 6)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Pass key in this browser</dt>
              <dd>{keyMatches ? "Matches" : "Missing"}</dd>
            </div>
          </dl>
        )}
        {registered && !keyMatches && (
          <p
            role="alert"
            className="mb-4 rounded-xl border border-destructive p-3 text-xs text-destructive"
          >
            The secret for your on-chain pass key is not in this browser (it was
            registered elsewhere, or storage was cleared). Your delivery QR
            cannot be created here. Use the browser you registered with, or
            register again with a different wallet.
          </p>
        )}
        {registered && apiVendor && (
          <div className="mb-4 flex items-center gap-3">
            {apiVendor.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={apiVendor.logoUrl}
                alt=""
                className="size-12 rounded-xl object-cover"
              />
            )}
            <div className="min-w-0">
              <p className="text-sm font-semibold">{apiVendor.name}</p>
              {apiVendor.description && (
                <p className="text-xs text-muted">{apiVendor.description}</p>
              )}
            </div>
          </div>
        )}
        {profile === undefined ? (
          <p className="text-sm text-muted">Reading your vendor account...</p>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <label className="block text-xs font-medium">
              Vendor name
              <input
                className={`${inputClass} mt-1`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={apiVendor?.name ?? "Taco Truck"}
                maxLength={100}
              />
            </label>
            <label className="block text-xs font-medium">
              Logo URL (optional)
              <input
                className={`${inputClass} mt-1`}
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                placeholder="https://..."
                inputMode="url"
              />
            </label>
            <label className="block text-xs font-medium">
              Description (optional)
              <textarea
                className={`${inputClass} mt-1`}
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={2000}
              />
            </label>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <button type="submit" disabled={busy} className={primaryBtn}>
              {busy
                ? "Confirm in your wallet..."
                : registered
                  ? apiVendor
                    ? "Update profile"
                    : "Save profile"
                  : "Register vendor"}
            </button>
            {!registered && (
              <p className="text-xs text-muted">
                A throwaway key is created in this browser and registered
                on-chain. It signs your delivery QR codes and cannot move funds.
              </p>
            )}
          </form>
        )}
      </Card>

      {registered && (
        <Card
          title={`My sponsorships ${sponsorships ? `(${sponsorships.length})` : ""}`}
        >
          {sponsorships === undefined ? (
            <p className="text-sm text-muted">Loading...</p>
          ) : sponsorships.length === 0 ? (
            <p className="text-sm text-muted">
              Nothing yet. Open an event page and propose a sponsorship.
            </p>
          ) : (
            <ul className="divide-y divide-border-low">
              {sponsorships.map((s) => {
                const ev = events?.get(s.data.event);
                const ended = ev?.status === EventStatus.Ended;
                return (
                  <li key={s.address} className="space-y-2 py-3 text-xs">
                    <div className="flex items-start justify-between gap-3">
                      <Link
                        href={`/events/${s.data.event}`}
                        className="font-mono underline-offset-2 hover:underline"
                      >
                        {ellipsify(s.data.event, 6)}
                      </Link>
                      <div className="text-right">
                        <p className="text-sm font-semibold">
                          {formatSol(s.data.amount, 6)} SOL
                        </p>
                        <span className="rounded-full bg-cream px-2 py-0.5 text-muted">
                          {sponsorshipStatusLabel(s.data.status)}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {(s.data.status === SponsorshipStatus.Approved ||
                        s.data.status === SponsorshipStatus.Delivered) && (
                        <Link
                          href={`/events/${s.data.event}/vendor-pass`}
                          className={linkBtn}
                        >
                          Show vendor pass
                        </Link>
                      )}
                      {s.data.status === SponsorshipStatus.Delivered && (
                        <>
                          <SettleVendorButton
                            event={s.data.event}
                            sponsorship={s.address}
                            vendor={s.data.vendor}
                            eventEnded={ended}
                            onDone={() => mutateSponsorships()}
                          />
                          {!ended && (
                            <span className="text-muted">
                              Payable once the event has ended.
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
        </Card>
      )}
    </div>
  );
}
