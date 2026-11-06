"use client";

import { useCallback, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { IDetectedBarcode, IScannerError } from "@yudiel/react-qr-scanner";

// The scanner touches `navigator.mediaDevices`; load it on the client only.
const Scanner = dynamic(
  () => import("@yudiel/react-qr-scanner").then((m) => m.Scanner),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center text-sm text-muted">
        Starting camera...
      </div>
    ),
  }
);

export type QrScannerProps = {
  /** Called with the raw decoded text. Repeat reads of the same text within `dedupeMs` are dropped. */
  onScan: (text: string) => void;
  /** Called for camera/permission errors in addition to the built-in error UI. */
  onError?: (error: IScannerError) => void;
  /** Pause detection (keeps the camera open). */
  paused?: boolean;
  /** Ignore identical consecutive reads within this window. Default 2000 ms. */
  dedupeMs?: number;
  className?: string;
};

const ERROR_COPY: Record<string, string> = {
  "permission-denied":
    "Camera permission was denied. Allow camera access in your browser settings, then try again.",
  "no-camera": "No camera was found on this device.",
  "in-use": "The camera is in use by another app. Close it and try again.",
  "insecure-context":
    "Camera access needs a secure (https) connection or localhost.",
  unsupported: "This browser does not support camera scanning.",
};

/** Camera QR scanner with permission/error states and repeat-read dedupe. */
export function QrScanner({
  onScan,
  onError,
  paused,
  dedupeMs = 2000,
  className,
}: QrScannerProps) {
  const [error, setError] = useState<IScannerError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const last = useRef<{ text: string; at: number } | null>(null);

  const handleScan = useCallback(
    (codes: IDetectedBarcode[]) => {
      const text = codes[0]?.rawValue;
      if (!text) return;
      const now = Date.now();
      const prev = last.current;
      if (prev && prev.text === text && now - prev.at < dedupeMs) return;
      last.current = { text, at: now };
      onScan(text);
    },
    [onScan, dedupeMs]
  );

  const handleError = useCallback(
    (e: IScannerError) => {
      setError(e);
      onError?.(e);
    },
    [onError]
  );

  return (
    <div
      className={`relative aspect-square w-full overflow-hidden rounded-2xl border border-border-low bg-black ${className ?? ""}`}
    >
      {error ? (
        <div
          role="alert"
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-card p-6 text-center"
        >
          <p className="text-sm font-medium">Camera unavailable</p>
          <p className="text-xs text-muted">
            {ERROR_COPY[error.kind] ?? error.message}
          </p>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setAttempt((n) => n + 1);
            }}
            className="cursor-pointer rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground"
          >
            Try again
          </button>
        </div>
      ) : (
        <Scanner
          key={attempt}
          onScan={handleScan}
          onError={handleError}
          paused={paused}
          formats={["qr_code"]}
          constraints={{ facingMode: "environment" }}
          scanDelay={200}
          allowMultiple
        />
      )}
    </div>
  );
}
