import type { Address } from "@solana/kit";

/** Deployed (and localnet-loaded) program id for `event_pool`. */
export const PROGRAM_ID = (process.env.NEXT_PUBLIC_PROGRAM_ID ??
  "E4SJunPXu5ZyoiSpz9Nk4jUAQWjj7qif6fTBDjR1Ping") as Address;

/** Mirrors `MIN_ENTRY_FEE` in the program (lamports). */
export const MIN_ENTRY_FEE_LAMPORTS = 1_000_000n;

/** A scanned QR payload is rejected when older (or newer) than this many seconds. */
export const QR_MAX_AGE_SECS = 30;

/** The ticket QR re-signs and refreshes on this interval. */
export const QR_REFRESH_SECS = 20;
