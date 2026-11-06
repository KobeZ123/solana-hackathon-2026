"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { QR_REFRESH_SECS } from "../lib/config";
import { encodePayload, type CheckinPayload } from "../lib/qr/payload";

export type QrDisplayProps = {
  /** Called on mount and every `refreshSecs` to produce a fresh payload (object is JSON-encoded, string used as is). */
  getPayload: () => CheckinPayload | string;
  /** QR side length in px (the ring adds a margin). Default 256. */
  size?: number;
  /** Refresh interval in seconds. Default `QR_REFRESH_SECS`. */
  refreshSecs?: number;
  /** Called after each refresh with the encoded value. */
  onRefresh?: (value: string) => void;
  className?: string;
};

const RING_PAD = 14;
const STROKE = 5;

function encode(p: CheckinPayload | string): string {
  return typeof p === "string" ? p : encodePayload(p);
}

/**
 * Renders a QR code that re-signs itself every `refreshSecs`, surrounded by a
 * ring that drains as the code approaches its next refresh.
 */
export function QrDisplay({
  getPayload,
  size = 256,
  refreshSecs = QR_REFRESH_SECS,
  onRefresh,
  className,
}: QrDisplayProps) {
  const [value, setValue] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(refreshSecs);
  const [error, setError] = useState<string | null>(null);

  // Keep latest callbacks without restarting the timer.
  const getPayloadRef = useRef(getPayload);
  const onRefreshRef = useRef(onRefresh);
  useEffect(() => {
    getPayloadRef.current = getPayload;
    onRefreshRef.current = onRefresh;
  });

  const refresh = useCallback(() => {
    try {
      const next = encode(getPayloadRef.current());
      setValue(next);
      setError(null);
      onRefreshRef.current?.(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create QR code");
    }
  }, []);

  useEffect(() => {
    let nextAt = Date.now() + refreshSecs * 1000;
    refresh();
    const id = window.setInterval(() => {
      const left = nextAt - Date.now();
      if (left <= 0) {
        nextAt = Date.now() + refreshSecs * 1000;
        refresh();
        setRemaining(refreshSecs);
      } else {
        setRemaining(left / 1000);
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [refresh, refreshSecs]);

  const box = size + RING_PAD * 2;
  const radius = (box - STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const fraction = Math.max(0, Math.min(1, remaining / refreshSecs));

  return (
    <div
      className={className}
      style={{ width: box }}
      role="img"
      aria-label="Ticket QR code"
    >
      <div className="relative" style={{ width: box, height: box }}>
        <svg
          width={box}
          height={box}
          className="absolute inset-0 -rotate-90"
          aria-hidden
        >
          <circle
            cx={box / 2}
            cy={box / 2}
            r={radius}
            fill="none"
            strokeWidth={STROKE}
            className="stroke-border-low"
          />
          <circle
            cx={box / 2}
            cy={box / 2}
            r={radius}
            fill="none"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - fraction)}
            className="stroke-primary"
            style={{ transition: "stroke-dashoffset 250ms linear" }}
          />
        </svg>
        <div
          className="absolute rounded-2xl bg-white p-3"
          style={{
            inset: RING_PAD,
            // Keep a quiet zone around the code regardless of theme.
          }}
        >
          {value ? (
            <QRCodeSVG
              value={value}
              size={size - 24}
              level="M"
              marginSize={0}
              bgColor="#ffffff"
              fgColor="#000000"
            />
          ) : (
            <div
              style={{ width: size - 24, height: size - 24 }}
              className="animate-pulse rounded bg-neutral-200"
            />
          )}
        </div>
      </div>
      <p className="mt-2 text-center text-xs text-muted" aria-live="off">
        {error ? error : `Refreshes in ${Math.ceil(remaining)}s`}
      </p>
    </div>
  );
}
