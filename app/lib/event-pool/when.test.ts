import { describe, expect, it } from "vitest";
import { fillPercent, formatEventWhen } from "./when";

// 2026-11-15 13:47:00 UTC
const T = 1_794_750_420;

describe("formatEventWhen", () => {
  it("formats a same-day window", () => {
    const w = formatEventWhen(T, T + 7200, { timeZone: "UTC" });
    expect(w.date).toBe("Sun, Nov 15");
    expect(w.time).toBe("1:47 PM - 3:47 PM");
  });
  it("shows the end date when the window spans days", () => {
    const w = formatEventWhen(T, T + 86_400, { timeZone: "UTC" });
    expect(w.time).toBe("1:47 PM - Mon, Nov 16, 1:47 PM");
  });
  it("accepts bigint seconds", () => {
    expect(
      formatEventWhen(BigInt(T), BigInt(T + 60), { timeZone: "UTC" }).date
    ).toBe("Sun, Nov 15");
  });
});

describe("fillPercent", () => {
  it("rounds and clamps", () => {
    expect(fillPercent(3, 25)).toBe(12);
    expect(fillPercent(30, 25)).toBe(100);
    expect(fillPercent(0, 0)).toBe(0);
  });
});
