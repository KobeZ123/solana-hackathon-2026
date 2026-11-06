import { describe, expect, it } from "vitest";
import {
  formatSol,
  localInputToUnix,
  percentToBps,
  poolFromVaultBalance,
  solToLamports,
  unixToLocalInput,
  VAULT_RENT_MIN_LAMPORTS,
} from "./format";
import {
  validateCreateEventForm,
  type CreateEventFormValues,
} from "./create-event-form";

describe("format", () => {
  it("converts percent to bps", () => {
    expect(percentToBps(30)).toBe(3000);
    expect(percentToBps(10)).toBe(1000);
    expect(percentToBps(12.5)).toBe(1250);
  });

  it("parses SOL to exact lamports", () => {
    expect(solToLamports("0.001")).toBe(1_000_000n);
    expect(solToLamports("1")).toBe(1_000_000_000n);
    expect(solToLamports(".5")).toBe(500_000_000n);
    expect(solToLamports("0.123456789")).toBe(123_456_789n);
    expect(solToLamports("0.1234567891")).toBeNull();
    expect(solToLamports("")).toBeNull();
    expect(solToLamports("-1")).toBeNull();
    expect(solToLamports("abc")).toBeNull();
    expect(solToLamports("1e3")).toBeNull();
  });

  it("formats lamports as SOL", () => {
    expect(formatSol(0n)).toBe("0");
    expect(formatSol(1_000_000_000n)).toBe("1");
    expect(formatSol(1_500_000_000n)).toBe("1.5");
    expect(formatSol(890_880n, 6)).toBe("0.00089");
    expect(formatSol(890_880n, 8)).toBe("0.00089088");
    expect(formatSol(1_000_000n)).toBe("0.001");
    expect(formatSol(-2_500_000_000n)).toBe("-2.5");
  });

  it("computes pool above the rent floor", () => {
    expect(poolFromVaultBalance(VAULT_RENT_MIN_LAMPORTS)).toBe(0n);
    expect(poolFromVaultBalance(0n)).toBe(0n);
    expect(poolFromVaultBalance(VAULT_RENT_MIN_LAMPORTS + 5n)).toBe(5n);
  });

  it("round trips datetime-local values", () => {
    const ts = localInputToUnix("2030-05-06T07:08");
    expect(ts).not.toBeNull();
    expect(unixToLocalInput(ts!)).toBe("2030-05-06T07:08");
    expect(localInputToUnix("")).toBeNull();
    expect(localInputToUnix("nope")).toBeNull();
  });
});

describe("validateCreateEventForm", () => {
  const now = Math.floor(new Date("2030-01-01T00:00").getTime() / 1000);
  const base: CreateEventFormValues = {
    title: " Rooftop Meetup ",
    summary: "",
    location: "1 Main St",
    description: "Bring snacks",
    coverUrl: "",
    feeSol: "0.1",
    capacity: "50",
    start: "2030-01-02T18:00",
    end: "2030-01-02T21:00",
    payoutPercent: 30,
    visibility: "public",
  };

  it("accepts a valid form and converts units", () => {
    const r = validateCreateEventForm(base, now);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.title).toBe("Rooftop Meetup");
    expect(r.value.entryFee).toBe(100_000_000n);
    expect(r.value.capacity).toBe(50);
    expect(r.value.payoutBps).toBe(3000);
    expect(r.value.coverUrl).toBeNull();
    expect(r.value.endTs - r.value.startTs).toBe(3n * 3600n);
    expect(r.value.details).toEqual({
      location: "1 Main St",
      description: "Bring snacks",
    });
  });

  function errorsFor(patch: Partial<CreateEventFormValues>) {
    const r = validateCreateEventForm({ ...base, ...patch }, now);
    return r.ok ? {} : r.errors;
  }

  it("mirrors program rules", () => {
    expect(errorsFor({ feeSol: "0.0005" }).feeSol).toMatch(/Minimum/);
    expect(errorsFor({ feeSol: "x" }).feeSol).toBeDefined();
    expect(errorsFor({ capacity: "0" }).capacity).toBeDefined();
    expect(errorsFor({ capacity: "1.5" }).capacity).toBeDefined();
    expect(errorsFor({ capacity: "4294967296" }).capacity).toBeDefined();
    expect(errorsFor({ end: "2030-01-02T17:00" }).end).toMatch(/after start/);
    expect(errorsFor({ start: "2029-12-31T10:00" }).start).toBeDefined();
    expect(errorsFor({ payoutPercent: 5 }).payoutPercent).toBeDefined();
    expect(errorsFor({ payoutPercent: 60 }).payoutPercent).toBeDefined();
  });

  it("validates text fields and cover url", () => {
    expect(errorsFor({ title: "  " }).title).toBeDefined();
    expect(errorsFor({ title: "x".repeat(201) }).title).toBeDefined();
    expect(errorsFor({ location: "" }).location).toBeDefined();
    expect(
      errorsFor({ coverUrl: "javascript:alert(1)" }).coverUrl
    ).toBeDefined();
    expect(errorsFor({ coverUrl: "not a url" }).coverUrl).toBeDefined();
    const r = validateCreateEventForm(
      { ...base, coverUrl: "https://example.com/a.png" },
      now
    );
    expect(r.ok && r.value.coverUrl).toBe("https://example.com/a.png");
  });
});
