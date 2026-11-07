/**
 * "Sun, Nov 15" and "8:47 AM - 10:47 AM" style labels for an event's window.
 * Pure (takes unix seconds and an optional locale/timezone) so it is easy to test.
 */
export interface EventWhen {
  /** e.g. "Sun, Nov 15" */
  date: string;
  /** e.g. "8:47 AM - 10:47 AM", or "8:47 AM - Mon, Nov 16, 1:00 AM" when it spans days */
  time: string;
}

export function formatEventWhen(
  startTs: bigint | number,
  endTs: bigint | number,
  opts: { locale?: string; timeZone?: string } = {}
): EventWhen {
  const { locale = "en-US", timeZone } = opts;
  const start = new Date(Number(startTs) * 1000);
  const end = new Date(Number(endTs) * 1000);
  const dateFmt = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone,
  });
  const timeFmt = new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
  const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone });
  const sameDay = dayKey.format(start) === dayKey.format(end);
  return {
    date: dateFmt.format(start),
    time: sameDay
      ? `${timeFmt.format(start)} - ${timeFmt.format(end)}`
      : `${timeFmt.format(start)} - ${dateFmt.format(end)}, ${timeFmt.format(end)}`,
  };
}

/** Whole-number percent (0-100) of capacity that is taken; 0 when capacity is 0. */
export function fillPercent(sold: number, capacity: number): number {
  if (capacity <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((sold / capacity) * 100)));
}
