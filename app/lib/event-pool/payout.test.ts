import { describe, expect, it } from "vitest";
import { EventStatus } from "../../generated/event_pool";
import { computePayout, hostActions, settledPayout } from "./payout";

const RENT = 890_880n;

describe("computePayout", () => {
  it("excludes the rent floor and splits by bps", () => {
    // 3 joined at 0.1 SOL, 30%, 2 checked in (T13 lifecycle shape)
    const fee = 100_000_000n;
    const p = computePayout({
      vaultLamports: RENT + 3n * fee,
      payoutBps: 3000,
      checkedIn: 2,
    });
    expect(p.pool).toBe(300_000_000n);
    expect(p.attendeePool).toBe(90_000_000n);
    expect(p.hostBudget).toBe(210_000_000n);
    expect(p.perAttendee).toBe(45_000_000n);
    expect(p.dust).toBe(0n);
    expect(p.hostWithdraw).toBe(210_000_000n);
  });

  it("uses integer math and releases dust to the host", () => {
    const p = computePayout({
      vaultLamports: RENT + 1_000_001n,
      payoutBps: 3333,
      checkedIn: 3,
    });
    expect(p.attendeePool).toBe((1_000_001n * 3333n) / 10_000n); // 333_300
    expect(p.perAttendee).toBe(p.attendeePool / 3n);
    expect(p.dust).toBe(p.attendeePool - p.perAttendee * 3n);
    expect(p.dust).toBeGreaterThanOrEqual(0n);
    expect(p.dust).toBeLessThan(3n);
    // Nothing is created or lost: payouts <= pool, remainder is exactly nothing.
    expect(p.perAttendee * 3n + p.hostWithdraw).toBe(p.pool);
  });

  it("rolls the attendee pool into the host budget with zero check-ins", () => {
    const p = computePayout({
      vaultLamports: RENT + 1_000_000n,
      payoutBps: 3000,
      checkedIn: 0,
    });
    expect(p.attendeePool).toBe(0n);
    expect(p.hostBudget).toBe(1_000_000n);
    expect(p.perAttendee).toBe(0n);
    expect(p.dust).toBe(0n);
    expect(p.hostWithdraw).toBe(1_000_000n);
  });

  it("subtracts approved sponsorships from the host withdrawal", () => {
    const p = computePayout({
      vaultLamports: RENT + 1_000_000n,
      payoutBps: 0,
      checkedIn: 1,
      approvedSponsorTotal: 250_000n,
    });
    expect(p.hostWithdraw).toBe(750_000n);
  });

  it("never goes negative when the vault is at or below rent", () => {
    for (const v of [0n, RENT - 1n, RENT]) {
      const p = computePayout({
        vaultLamports: v,
        payoutBps: 3000,
        checkedIn: 2,
      });
      expect(p.pool).toBe(0n);
      expect(p.hostWithdraw).toBe(0n);
    }
  });

  it("handles 100% payout and large values without overflow", () => {
    const big = 10n ** 18n;
    const p = computePayout({
      vaultLamports: RENT + big,
      payoutBps: 10_000,
      checkedIn: 7,
    });
    expect(p.attendeePool).toBe(big);
    expect(p.hostBudget).toBe(0n);
    expect(p.perAttendee * 7n + p.dust).toBe(big);
    expect(p.hostWithdraw).toBe(p.dust);
  });
});

describe("settledPayout", () => {
  it("matches the on-chain snapshot", () => {
    const p = settledPayout({
      attendeePool: 100n,
      hostBudget: 900n,
      checkedIn: 3,
      approvedSponsorTotal: 0n,
    });
    expect(p.perAttendee).toBe(33n);
    expect(p.dust).toBe(1n);
    expect(p.hostWithdraw).toBe(901n);
    expect(p.pool).toBe(1000n);
  });
});

describe("hostActions", () => {
  const base = {
    startTs: 1000n,
    endTs: 2000n,
    hostWithdrawn: false,
  };
  it("offers cancel only before start while open", () => {
    expect(hostActions({ ...base, status: EventStatus.Open }, 999)).toEqual({
      cancel: true,
      end: false,
      withdraw: false,
    });
    expect(
      hostActions({ ...base, status: EventStatus.Open }, 1000).cancel
    ).toBe(false);
  });
  it("offers end only at or after end_ts", () => {
    expect(hostActions({ ...base, status: EventStatus.Open }, 1500).end).toBe(
      false
    );
    expect(hostActions({ ...base, status: EventStatus.Open }, 2000).end).toBe(
      true
    );
  });
  it("offers withdraw once ended and not withdrawn", () => {
    expect(hostActions({ ...base, status: EventStatus.Ended }, 3000)).toEqual({
      cancel: false,
      end: false,
      withdraw: true,
    });
    expect(
      hostActions(
        { ...base, status: EventStatus.Ended, hostWithdrawn: true },
        3000
      ).withdraw
    ).toBe(false);
  });
  it("offers nothing when cancelled", () => {
    expect(
      hostActions({ ...base, status: EventStatus.Cancelled }, 500)
    ).toEqual({ cancel: false, end: false, withdraw: false });
  });
});
