import { MIN_ENTRY_FEE_LAMPORTS } from "../config";
import {
  PAYOUT_PCT_MAX,
  PAYOUT_PCT_MIN,
  localInputToUnix,
  percentToBps,
  solToLamports,
} from "./format";

export type CreateEventFormValues = {
  title: string;
  summary: string;
  location: string;
  description: string;
  coverUrl: string;
  /** Entry fee in SOL, decimal string. */
  feeSol: string;
  capacity: string;
  /** `datetime-local` values. */
  start: string;
  end: string;
  payoutPercent: number;
  visibility: "public" | "network";
};

export type FormErrors = Partial<Record<keyof CreateEventFormValues, string>>;

export type ValidatedEvent = {
  title: string;
  summary: string;
  coverUrl: string | null;
  details: { location: string; description: string };
  entryFee: bigint;
  capacity: number;
  startTs: bigint;
  endTs: bigint;
  payoutBps: number;
  visibility: "public" | "network";
};

const U32_MAX = 4_294_967_295;
const U64_MAX = 18_446_744_073_709_551_615n;

/** Mirrors the program's create_event rules plus the API's field limits. */
export function validateCreateEventForm(
  v: CreateEventFormValues,
  nowSecs: number = Math.floor(Date.now() / 1000)
): { ok: true; value: ValidatedEvent } | { ok: false; errors: FormErrors } {
  const errors: FormErrors = {};

  const title = v.title.trim();
  if (!title) errors.title = "Title is required";
  else if (title.length > 200) {
    errors.title = "Title must be 200 characters or fewer";
  }

  const summary = v.summary.trim();
  if (summary.length > 2000) {
    errors.summary = "Summary must be 2000 characters or fewer";
  }

  const location = v.location.trim();
  const description = v.description.trim();
  if (!location) {
    errors.location = "Location is required (shown to ticket holders only)";
  }
  if (JSON.stringify({ location, description }).length > 40_000) {
    errors.description = "Details are too long";
  }

  let coverUrl: string | null = null;
  const cover = v.coverUrl.trim();
  if (cover) {
    try {
      const u = new URL(cover);
      if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error();
      if (cover.length > 2000) errors.coverUrl = "URL is too long";
      coverUrl = cover;
    } catch {
      errors.coverUrl = "Enter a valid http(s) URL";
    }
  }

  const fee = solToLamports(v.feeSol);
  if (fee === null) errors.feeSol = "Enter a fee in SOL (up to 9 decimals)";
  else if (fee < MIN_ENTRY_FEE_LAMPORTS) {
    errors.feeSol = "Minimum entry fee is 0.001 SOL";
  } else if (fee > U64_MAX) errors.feeSol = "Fee is too large";

  let capacity = 0;
  if (!/^\d+$/.test(v.capacity.trim())) {
    errors.capacity = "Capacity must be a whole number";
  } else {
    capacity = Number(v.capacity.trim());
    if (capacity < 1) errors.capacity = "Capacity must be at least 1";
    else if (capacity > U32_MAX) errors.capacity = "Capacity is too large";
  }

  const startTs = localInputToUnix(v.start);
  const endTs = localInputToUnix(v.end);
  if (startTs === null) errors.start = "Pick a start date and time";
  if (endTs === null) errors.end = "Pick an end date and time";
  if (startTs !== null && endTs !== null && endTs <= startTs) {
    errors.end = "End must be after start";
  }
  if (endTs !== null && !errors.end && endTs <= nowSecs) {
    errors.end = "End must be in the future";
  }
  if (startTs !== null && startTs <= nowSecs && !errors.end) {
    errors.start = "Start must be in the future";
  }

  if (
    !Number.isFinite(v.payoutPercent) ||
    v.payoutPercent < PAYOUT_PCT_MIN ||
    v.payoutPercent > PAYOUT_PCT_MAX
  ) {
    errors.payoutPercent = `Payout must be between ${PAYOUT_PCT_MIN}% and ${PAYOUT_PCT_MAX}%`;
  }

  if (
    Object.keys(errors).length > 0 ||
    fee === null ||
    startTs === null ||
    endTs === null
  ) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      title,
      summary,
      coverUrl,
      details: { location, description },
      entryFee: fee,
      capacity,
      startTs: BigInt(startTs),
      endTs: BigInt(endTs),
      payoutBps: percentToBps(v.payoutPercent),
      visibility: v.visibility,
    },
  };
}
