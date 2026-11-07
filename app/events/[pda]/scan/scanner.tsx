"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { address, type Address, type TransactionSigner } from "@solana/kit";
import {
  EventStatus,
  findTicketPda,
  getCheckInInstruction,
  getConfirmDeliveryInstruction,
  getSetGateInstruction,
  SponsorshipStatus,
  EVENT_POOL_ERROR__ALREADY_CHECKED_IN,
} from "../../../generated/event_pool";
import { QrScanner } from "../../../components/qr-scanner";
import { SettleVendorButton } from "../../../components/settle-vendor-button";
import { useCluster } from "../../../components/cluster-context";
import { useWallet } from "../../../lib/wallet/context";
import { useBalance } from "../../../lib/hooks/use-balance";
import { useEvent } from "../../../lib/event-pool/hooks";
import { useSendTransaction } from "../../../lib/hooks/use-send-transaction";
import { useSolanaClient } from "../../../lib/solana-client-context";
import { parseTransactionError } from "../../../lib/errors";
import { ellipsify } from "../../../lib/explorer";
import {
  formatSol,
  type GateKey,
  buildTicketCache,
  decideScan,
  fetchEventTickets,
  generateGateKey,
  loadGateKey,
  saveGateKey,
  gateSigner,
  getTransferSolInstruction,
  createPayerSender,
  programErrorCode,
  REJECT_COPY,
  DELIVERY_REJECT_COPY,
  decideDelivery,
  sponsorshipErrorMessage,
  sponsorshipStatusLabel,
  useEventSponsorships,
  useVendorKeys,
  type CachedSponsorship,
  type DeliveryRejectReason,
  type RejectReason,
  type TicketCache,
} from "../../../lib/event-pool";

/** Fund the gate key with this much (lamports): ~2000 check-in fees. */
const GATE_FUND_LAMPORTS = 10_000_000n;
/** Below this the gate may not be able to pay fees. */
const GATE_LOW_LAMPORTS = 100_000n;
const CACHE_REFRESH_MS = 15_000;
const RETRY_MS = 10_000;
const RESULT_CLEAR_MS = 2_000;

type Result =
  | { kind: "ok"; member: string }
  | { kind: "reject"; reason: RejectReason; member?: string }
  | { kind: "error"; message: string; member: string }
  | { kind: "queued"; member: string }
  | { kind: "delivery_ok"; vendor: string; amount: bigint }
  | { kind: "delivery_reject"; reason: DeliveryRejectReason; vendor?: string }
  | { kind: "delivery_error"; vendor: string; message: string };

type Mode = "tickets" | "delivery";

type QueueItem = { member: string; error: string; attempts: number };

const nowSecs = () => Math.floor(Date.now() / 1000);

function Card({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-border-low bg-card p-5">
      {children}
    </div>
  );
}

function Notice({ title, body }: { title: string; body: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-xl">
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Scanner</h1>
      <div className="mt-6 rounded-2xl border border-border-low bg-card p-6">
        <p className="text-sm font-medium">{title}</p>
        <div className="mt-1 text-sm text-muted">{body}</div>
      </div>
    </div>
  );
}

export function Scanner({ pda }: { pda: string }) {
  const { wallet, signer: walletTxSigner } = useWallet();
  const { cluster, getExplorerUrl } = useCluster();
  const client = useSolanaClient();
  const { send, isSending } = useSendTransaction();
  const { event: state, isLoading, mutate: refreshEvent } = useEvent(pda);

  const [gateKey, setGateKey] = useState<GateKey | null>(() =>
    typeof window === "undefined" ? null : loadGateKey(pda)
  );
  const [signer, setSigner] = useState<TransactionSigner | null>(null);
  const gateAddress = gateKey ? (gateKey.publicKey as Address) : undefined;
  const { lamports: gateBalance } = useBalance(gateAddress);

  const [result, setResult] = useState<Result | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [okCount, setOkCount] = useState(0);
  const [rejectCount, setRejectCount] = useState(0);
  const [cacheSize, setCacheSize] = useState<number | null>(null);
  const [cacheError, setCacheError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("tickets");
  const { sponsorships, mutate: refreshSponsorships } = useEventSponsorships(
    pda,
    CACHE_REFRESH_MS
  );
  const { vendorKeys, mutate: refreshVendorKeys } = useVendorKeys(
    (sponsorships ?? []).map((s) => s.data.vendor)
  );
  const sponsorshipsRef = useRef<ReadonlyMap<string, CachedSponsorship>>(
    new Map()
  );
  const vendorKeysRef = useRef<ReadonlyMap<string, string>>(new Map());
  const deliveredLocally = useRef<Set<string>>(new Set());

  const cacheRef = useRef<TicketCache>(new Map());
  const localCheckedIn = useRef<Set<string>>(new Set());
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventAddr = state ? (pda as Address) : undefined;

  useEffect(() => {
    sponsorshipsRef.current = new Map(
      (sponsorships ?? []).map((s) => [
        s.data.vendor as string,
        { address: s.address, status: s.data.status, amount: s.data.amount },
      ])
    );
  }, [sponsorships]);
  useEffect(() => {
    vendorKeysRef.current = vendorKeys ?? new Map();
  }, [vendorKeys]);

  // Signer for the gate key (no wallet popup).
  useEffect(() => {
    if (!gateKey) return;
    let cancelled = false;
    void gateSigner(gateKey).then((s) => {
      if (!cancelled) setSigner(s);
    });
    return () => {
      cancelled = true;
      setSigner(null);
    };
  }, [gateKey]);

  const sendAsGate = useMemo(
    () => (signer ? createPayerSender(cluster, signer) : null),
    [cluster, signer]
  );

  const refreshCache = useCallback(async () => {
    if (!eventAddr) return;
    try {
      const tickets = await fetchEventTickets(client.rpc, eventAddr);
      const map = buildTicketCache(
        tickets.map((t) => ({
          member: t.data.member,
          ticketKey: t.data.ticketKey,
          checkedIn: t.data.checkedIn,
        }))
      );
      cacheRef.current = map;
      setCacheSize(map.size);
      setCacheError(null);
    } catch (err) {
      // Keep the previous cache: verification needs no network once cached.
      setCacheError(err instanceof Error ? err.message : String(err));
    }
  }, [client, eventAddr]);

  useEffect(() => {
    if (!eventAddr) return;
    const first = setTimeout(() => void refreshCache(), 0);
    const id = setInterval(() => void refreshCache(), CACHE_REFRESH_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [eventAddr, refreshCache]);

  const show = useCallback((r: Result) => {
    setResult(r);
    if (clearTimer.current) clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => setResult(null), RESULT_CLEAR_MS);
  }, []);

  useEffect(
    () => () => {
      if (clearTimer.current) clearTimeout(clearTimer.current);
    },
    []
  );

  /** Send check_in for one member as the gate. Throws on failure. */
  const sendCheckIn = useCallback(
    async (member: string) => {
      if (!sendAsGate || !signer || !eventAddr) {
        throw new Error("Gate is not ready");
      }
      const [ticket] = await findTicketPda({
        event: eventAddr,
        member: address(member),
      });
      return sendAsGate([
        getCheckInInstruction({
          gate: signer,
          event: eventAddr,
          member: address(member),
          ticket,
        }),
      ]);
    },
    [sendAsGate, signer, eventAddr]
  );

  const settle = useCallback(
    async (member: string): Promise<"ok" | "queued" | "rejected"> => {
      try {
        await sendCheckIn(member);
        setOkCount((n) => n + 1);
        show({ kind: "ok", member });
        void refreshEvent();
        return "ok";
      } catch (err) {
        const code = programErrorCode(err);
        if (code === EVENT_POOL_ERROR__ALREADY_CHECKED_IN) {
          setRejectCount((n) => n + 1);
          show({ kind: "reject", reason: "already_checked_in", member });
          return "rejected";
        }
        if (code !== null) {
          // The program refused (e.g. window closed): retrying cannot help.
          localCheckedIn.current.delete(member);
          setRejectCount((n) => n + 1);
          show({ kind: "error", member, message: parseTransactionError(err) });
          return "rejected";
        }
        const message = err instanceof Error ? err.message : String(err);
        setQueue((q) =>
          q.some((i) => i.member === member)
            ? q.map((i) =>
                i.member === member
                  ? { ...i, error: message, attempts: i.attempts + 1 }
                  : i
              )
            : [...q, { member, error: message, attempts: 1 }]
        );
        show({ kind: "queued", member });
        return "queued";
      }
    },
    [sendCheckIn, show, refreshEvent]
  );

  const onScan = useCallback(
    async (text: string) => {
      if (!eventAddr || !sendAsGate) return;
      const decide = () =>
        decideScan({
          text,
          event: eventAddr,
          cache: cacheRef.current,
          now: nowSecs(),
          checkedInLocally: localCheckedIn.current,
        });
      let decision = decide();
      if (decision.kind === "reject" && decision.reason === "unknown_ticket") {
        // Cache miss: the ticket may have been bought since the last refresh.
        await refreshCache();
        decision = decide();
      }
      if (decision.kind === "reject") {
        setRejectCount((n) => n + 1);
        show(decision);
        return;
      }
      localCheckedIn.current.add(decision.member);
      await settle(decision.member);
    },
    [eventAddr, sendAsGate, refreshCache, show, settle]
  );

  /** Verify a vendor delivery QR, then confirm_delivery as the gate. */
  const onDeliveryScan = useCallback(
    async (text: string) => {
      if (!eventAddr || !sendAsGate || !signer) return;
      const decide = () =>
        decideDelivery({
          text,
          event: eventAddr,
          sponsorships: sponsorshipsRef.current,
          vendorKeys: vendorKeysRef.current,
          now: nowSecs(),
          deliveredLocally: deliveredLocally.current,
        });
      let decision = decide();
      if (
        decision.kind === "reject" &&
        (decision.reason === "no_sponsorship" ||
          decision.reason === "no_vendor_profile" ||
          decision.reason === "not_approved")
      ) {
        // Cache miss: the sponsorship may have been approved since the last refresh.
        const fresh = await refreshSponsorships();
        if (fresh) {
          sponsorshipsRef.current = new Map(
            fresh.map((s) => [
              s.data.vendor as string,
              {
                address: s.address,
                status: s.data.status,
                amount: s.data.amount,
              },
            ])
          );
        }
        const keys = await refreshVendorKeys();
        if (keys) vendorKeysRef.current = keys;
        decision = decide();
      }
      if (decision.kind === "reject") {
        setRejectCount((n) => n + 1);
        show({
          kind: "delivery_reject",
          reason: decision.reason,
          vendor: decision.vendor,
        });
        return;
      }
      deliveredLocally.current.add(decision.vendor);
      try {
        await sendAsGate([
          getConfirmDeliveryInstruction({
            gate: signer,
            event: eventAddr,
            sponsorship: decision.sponsorship,
          }),
        ]);
        setOkCount((n) => n + 1);
        show({
          kind: "delivery_ok",
          vendor: decision.vendor,
          amount: decision.amount,
        });
        void refreshSponsorships();
      } catch (err) {
        // Allow a re-scan: nothing was confirmed.
        deliveredLocally.current.delete(decision.vendor);
        setRejectCount((n) => n + 1);
        show({
          kind: "delivery_error",
          vendor: decision.vendor,
          message: sponsorshipErrorMessage(err),
        });
      }
    },
    [
      eventAddr,
      sendAsGate,
      signer,
      show,
      refreshSponsorships,
      refreshVendorKeys,
    ]
  );

  const retryOne = useCallback(
    async (member: string) => {
      try {
        await sendCheckIn(member);
        setOkCount((n) => n + 1);
        setQueue((q) => q.filter((i) => i.member !== member));
        void refreshEvent();
      } catch (err) {
        const code = programErrorCode(err);
        if (code !== null) {
          // Permanent failure: drop from the queue and allow a re-scan.
          localCheckedIn.current.delete(member);
          setQueue((q) => q.filter((i) => i.member !== member));
          toast.error(
            `${ellipsify(member)}: ${
              code === EVENT_POOL_ERROR__ALREADY_CHECKED_IN
                ? "already checked in"
                : parseTransactionError(err)
            }`
          );
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        setQueue((q) =>
          q.map((i) =>
            i.member === member
              ? { ...i, error: message, attempts: i.attempts + 1 }
              : i
          )
        );
      }
    },
    [sendCheckIn, refreshEvent]
  );

  const retryAll = useCallback(async () => {
    for (const item of queue) await retryOne(item.member);
  }, [queue, retryOne]);

  // Auto-retry queued check-ins (venue wifi comes and goes).
  const retryAllRef = useRef(retryAll);
  useEffect(() => {
    retryAllRef.current = retryAll;
  }, [retryAll]);
  const hasQueue = queue.length > 0;
  useEffect(() => {
    if (!hasQueue) return;
    const id = setInterval(() => void retryAllRef.current(), RETRY_MS);
    return () => clearInterval(id);
  }, [hasQueue]);

  // ---- gate setup actions ----
  const createGate = () => {
    const key = generateGateKey();
    if (!saveGateKey(pda, key)) {
      toast.warning(
        "Browser storage is unavailable: the gate key will be lost if you reload."
      );
    }
    setGateKey(key);
  };

  const fundGate = async () => {
    if (!wallet || !gateAddress) return;
    if (!walletTxSigner) return;
    try {
      const sig = await send({
        instructions: [
          getTransferSolInstruction({
            source: walletTxSigner,
            destination: gateAddress,
            amount: GATE_FUND_LAMPORTS,
          }),
        ],
      });
      toast.success("Gate funded", {
        action: {
          label: "Explorer",
          onClick: () => window.open(getExplorerUrl(`/tx/${sig}`), "_blank"),
        },
      });
    } catch (err) {
      toast.error(parseTransactionError(err));
    }
  };

  const authorizeGate = async () => {
    if (!walletTxSigner || !gateAddress || !eventAddr) return;
    try {
      const sig = await send({
        instructions: [
          getSetGateInstruction({
            host: walletTxSigner,
            event: eventAddr,
            gate: gateAddress,
          }),
        ],
      });
      await refreshEvent();
      toast.success("Gate authorized", {
        action: {
          label: "Explorer",
          onClick: () => window.open(getExplorerUrl(`/tx/${sig}`), "_blank"),
        },
      });
    } catch (err) {
      toast.error(parseTransactionError(err));
    }
  };

  // ---- render ----
  if (isLoading || state === undefined) {
    return (
      <Notice title="Loading event..." body="Reading the event account." />
    );
  }
  if (state === null) {
    return (
      <Notice
        title="Event not found"
        body={`No event account at ${ellipsify(pda)} on ${cluster}. Check the cluster selector.`}
      />
    );
  }
  if (!wallet) {
    return (
      <Notice
        title="Connect your wallet"
        body="Only the host can run the scanner. Connect the host wallet to continue."
      />
    );
  }
  if (wallet.account.address !== state.host) {
    return (
      <Notice
        title="Host only"
        body="The connected wallet is not this event's host."
      />
    );
  }
  if (state.status === EventStatus.Cancelled) {
    return (
      <Notice title="Scanner is closed" body="This event was cancelled." />
    );
  }
  // After the event ends only vendor deliveries can still be confirmed.
  const eventEnded = state.status === EventStatus.Ended;
  const activeMode: Mode = eventEnded ? "delivery" : mode;

  const authorized = gateKey?.publicKey === state.gateAuthority;
  const funded = gateBalance !== null && gateBalance >= GATE_LOW_LAMPORTS;
  const ready = authorized && funded;
  const startTs = Number(state.startTs);
  const opensAt = startTs - 3600;
  const beforeWindow = nowSecs() < opensAt;

  return (
    <div className="mx-auto w-full max-w-xl space-y-4">
      <div>
        <Link
          href={`/events/${pda}`}
          className="mb-4 inline-flex text-xs font-medium text-muted underline-offset-4 hover:text-foreground hover:underline"
        >
          &larr; Event
        </Link>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Scanner
        </h1>
      </div>

      <Card>
        <h2 className="text-sm font-semibold">1. Gate key</h2>
        <p className="mt-1 text-xs text-muted">
          A throwaway key in this browser signs check-ins so you never get a
          wallet popup at the door. It can only check people in.
        </p>
        {!gateKey ? (
          <button
            type="button"
            onClick={createGate}
            className="mt-4 h-11 w-full cursor-pointer rounded-xl bg-primary text-sm font-medium text-primary-foreground"
          >
            Generate gate key
          </button>
        ) : (
          <div className="mt-4 space-y-3">
            <dl className="space-y-1 text-xs">
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Gate address</dt>
                <dd className="font-mono">{ellipsify(gateKey.publicKey, 6)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Gate balance</dt>
                <dd>
                  {gateBalance === null
                    ? "..."
                    : `${formatSol(gateBalance, 5)} SOL`}
                </dd>
              </div>
            </dl>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={isSending}
                onClick={() => void fundGate()}
                className="h-11 cursor-pointer rounded-xl border border-border text-sm font-medium transition hover:bg-cream disabled:opacity-60"
              >
                {funded ? "Top up 0.01 SOL" : "Fund gate (0.01 SOL)"}
              </button>
              <button
                type="button"
                disabled={isSending || authorized}
                onClick={() => void authorizeGate()}
                className="h-11 cursor-pointer rounded-xl border border-border text-sm font-medium transition hover:bg-cream disabled:opacity-60"
              >
                {authorized ? "Gate authorized" : "Authorize gate"}
              </button>
            </div>
            <p className="text-xs text-muted">
              {authorized && funded
                ? "Ready to scan."
                : `${funded ? "" : "Fund the gate. "}${authorized ? "" : "Authorize it on-chain (one wallet popup)."}`}
            </p>
          </div>
        )}
      </Card>

      <Card>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">
            2.{" "}
            {activeMode === "tickets" ? "Scan tickets" : "Scan vendor passes"}
          </h2>
          <div
            role="group"
            aria-label="Scan mode"
            className="flex rounded-lg border border-border p-0.5 text-xs font-medium"
          >
            {(
              [
                ["tickets", "Tickets"],
                ["delivery", "Vendors"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={activeMode === value}
                disabled={eventEnded && value === "tickets"}
                onClick={() => setMode(value)}
                className={`cursor-pointer rounded-md px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-50 ${
                  activeMode === value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {eventEnded && (
          <p className="mt-1 text-xs text-muted">
            The event has ended: ticket check-in is closed, vendor delivery can
            still be confirmed.
          </p>
        )}
        {activeMode === "delivery" && !eventEnded && (
          <p className="mt-1 text-xs text-muted">
            Scan the QR on a vendor&apos;s pass when they deliver. It is checked
            against their registered key, then delivery is confirmed on-chain.
          </p>
        )}
        {beforeWindow && activeMode === "tickets" && (
          <p className="mt-1 text-xs text-muted">
            Check-in opens an hour before the start; scans before then will be
            refused by the program.
          </p>
        )}
        <div className="relative mt-4">
          <QrScanner
            onScan={(t) =>
              void (activeMode === "delivery" ? onDeliveryScan(t) : onScan(t))
            }
            paused={!ready}
          />
          {!ready && (
            <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-card/90 p-6 text-center text-sm text-muted">
              Finish gate setup to start scanning.
            </div>
          )}
          {result && <ResultOverlay result={result} />}
        </div>

        <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
          <Counter
            label={activeMode === "delivery" ? "Confirmed" : "Checked in"}
            value={okCount}
          />
          <Counter label="Rejected" value={rejectCount} />
          <Counter
            label="On-chain"
            value={`${state.checkedIn}/${state.ticketsSold}`}
          />
        </dl>
        <p className="mt-3 text-xs text-muted">
          {cacheSize === null
            ? "Loading tickets..."
            : `${cacheSize} tickets cached, refreshed every 15 s.`}
          {cacheError ? ` Last refresh failed: ${cacheError}` : ""}
        </p>
      </Card>

      {(activeMode === "delivery" || eventEnded) && (
        <Card>
          <h2 className="text-sm font-semibold">Vendor deliveries</h2>
          <p className="mt-1 text-xs text-muted">
            {eventEnded
              ? "The event has ended: anyone can now settle delivered sponsorships and the vendor is paid from the vault."
              : "Delivered sponsorships can be settled by anyone once you end the event."}
          </p>
          {(sponsorships ?? []).filter(
            (s) => s.data.status !== SponsorshipStatus.Rejected
          ).length === 0 ? (
            <p className="mt-3 text-sm text-muted">
              No approved sponsorships yet.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-border-low">
              {(sponsorships ?? [])
                .filter((s) => s.data.status !== SponsorshipStatus.Rejected)
                .map((s) => (
                  <li
                    key={s.address}
                    className="flex items-center justify-between gap-3 py-2 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="font-mono">{ellipsify(s.data.vendor, 6)}</p>
                      <p className="text-muted">
                        {formatSol(s.data.amount, 6)} SOL &middot;{" "}
                        {sponsorshipStatusLabel(s.data.status)}
                      </p>
                    </div>
                    {s.data.status === SponsorshipStatus.Delivered && (
                      <SettleVendorButton
                        event={pda}
                        sponsorship={s.address}
                        vendor={s.data.vendor}
                        eventEnded={eventEnded}
                        onDone={() => refreshSponsorships()}
                      />
                    )}
                  </li>
                ))}
            </ul>
          )}
        </Card>
      )}

      {queue.length > 0 && (
        <Card>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              Retry queue ({queue.length})
            </h2>
            <button
              type="button"
              onClick={() => void retryAll()}
              className="cursor-pointer rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-cream"
            >
              Retry all
            </button>
          </div>
          <p className="mt-1 text-xs text-muted">
            These people were verified, but the check-in did not reach the
            chain. Retrying automatically.
          </p>
          <ul className="mt-3 space-y-2">
            {queue.map((item) => (
              <li
                key={item.member}
                className="flex items-center justify-between gap-3 text-xs"
              >
                <div className="min-w-0">
                  <p className="font-mono">{ellipsify(item.member, 6)}</p>
                  <p className="truncate text-muted">
                    Attempt {item.attempts}: {item.error}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void retryOne(item.member)}
                  className="shrink-0 cursor-pointer rounded-lg border border-border px-3 py-1.5 font-medium hover:bg-cream"
                >
                  Retry
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Counter({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl bg-cream px-2 py-3">
      <dd className="text-xl font-bold">{value}</dd>
      <dt className="text-xs text-muted">{label}</dt>
    </div>
  );
}

function ResultOverlay({ result }: { result: Result }) {
  let tone = "bg-red-600";
  let title = "";
  let detail: string | null = null;
  let member: string | undefined;

  switch (result.kind) {
    case "ok":
      tone = "bg-green-600";
      title = "Checked in";
      member = result.member;
      break;
    case "queued":
      tone = "bg-amber-600";
      title = "Verified, will retry";
      detail = "Network problem. The check-in is queued below.";
      member = result.member;
      break;
    case "error":
      title = "Check-in refused";
      detail = result.message;
      member = result.member;
      break;
    case "reject":
      title = REJECT_COPY[result.reason].title;
      detail = REJECT_COPY[result.reason].hint;
      member = result.member;
      break;
    case "delivery_ok":
      tone = "bg-green-600";
      title = "Delivery confirmed";
      detail = `${formatSol(result.amount, 6)} SOL is payable to the vendor once the event has ended.`;
      member = result.vendor;
      break;
    case "delivery_reject":
      title = DELIVERY_REJECT_COPY[result.reason].title;
      detail = DELIVERY_REJECT_COPY[result.reason].hint;
      member = result.vendor;
      break;
    case "delivery_error":
      title = "Delivery not confirmed";
      detail = result.message;
      member = result.vendor;
      break;
  }

  return (
    <div
      role="status"
      aria-live="assertive"
      className={`absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-2xl p-6 text-center text-white ${tone}`}
    >
      <p className="text-3xl font-extrabold tracking-tight">{title}</p>
      {member && (
        <p className="break-all font-mono text-sm opacity-90">{member}</p>
      )}
      {detail && <p className="text-sm opacity-90">{detail}</p>}
    </div>
  );
}
