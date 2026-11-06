/** Pure formatting and conversion helpers shared by the event pages. */

export const LAMPORTS_PER_SOL = 1_000_000_000n;

/** Rent-exempt minimum for a 0-byte system account (the vault floor, never distributed). */
export const VAULT_RENT_MIN_LAMPORTS = 890_880n;

/** Attendee payout slider bounds in percent (UI rule; the program accepts 0-100). */
export const PAYOUT_PCT_MIN = 10;
export const PAYOUT_PCT_MAX = 50;
export const PAYOUT_PCT_DEFAULT = 30;

/** Percent (e.g. 30) to basis points (3000). Rounds to the nearest integer bps. */
export function percentToBps(percent: number): number {
  return Math.round(percent * 100);
}

export function bpsToPercent(bps: number): number {
  return bps / 100;
}

/**
 * Parse a decimal SOL string ("0.05", "1", ".5") into exact lamports.
 * Returns null for empty, negative, non-numeric or more than 9 decimals.
 */
export function solToLamports(input: string): bigint | null {
  const s = input.trim();
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(s)) return null;
  const [whole = "", frac = ""] = s.split(".");
  if (frac.length > 9) return null;
  return BigInt(whole || "0") * LAMPORTS_PER_SOL + BigInt(frac.padEnd(9, "0"));
}

/** Lamports to a SOL string, trimmed of trailing zeros (up to `maxDecimals`, truncating). */
export function formatSol(amount: bigint, maxDecimals = 4): string {
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const whole = abs / LAMPORTS_PER_SOL;
  const frac = (abs % LAMPORTS_PER_SOL)
    .toString()
    .padStart(9, "0")
    .slice(0, maxDecimals)
    .replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/** Spendable pool: vault balance minus the rent floor (never negative). */
export function poolFromVaultBalance(vaultLamports: bigint): bigint {
  return vaultLamports > VAULT_RENT_MIN_LAMPORTS
    ? vaultLamports - VAULT_RENT_MIN_LAMPORTS
    : 0n;
}

/** Unix seconds (number or bigint) to a short local date-time string. */
export function formatTimestamp(ts: bigint | number, locale?: string): string {
  return new Date(Number(ts) * 1000).toLocaleString(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** `datetime-local` input value ("2026-11-06T18:30", local time) to unix seconds, or null. */
export function localInputToUnix(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

/** Unix seconds to a `datetime-local` input value in local time. */
export function unixToLocalInput(ts: number): string {
  const d = new Date(ts * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
