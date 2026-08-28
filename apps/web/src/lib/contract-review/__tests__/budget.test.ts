import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  DEFAULT_REVIEW_DAILY_MAX_USD,
  checkReviewDailyCap,
  reviewDailyMaxUsd,
  reviewSpentTodayUsd,
  utcDayStart,
} from "../budget";

const aggregate = prisma.aIUsage.aggregate as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.CONTRACT_REVIEW_DAILY_MAX_USD;
});
afterEach(() => {
  delete process.env.CONTRACT_REVIEW_DAILY_MAX_USD;
});

describe("reviewDailyMaxUsd", () => {
  it("default sem env; env válida vence; lixo cai no default", () => {
    expect(reviewDailyMaxUsd()).toBe(DEFAULT_REVIEW_DAILY_MAX_USD);
    process.env.CONTRACT_REVIEW_DAILY_MAX_USD = "0.5";
    expect(reviewDailyMaxUsd()).toBe(0.5);
    process.env.CONTRACT_REVIEW_DAILY_MAX_USD = "abc";
    expect(reviewDailyMaxUsd()).toBe(DEFAULT_REVIEW_DAILY_MAX_USD);
  });
});

describe("reviewSpentTodayUsd", () => {
  const now = new Date("2026-08-28T15:30:00Z");

  it("soma o AIUsage do dia UTC da operação contract_review", async () => {
    aggregate.mockResolvedValue({ _sum: { estimatedCostUsd: "1.25" } });
    const spent = await reviewSpentTodayUsd("org1", now);
    expect(spent).toBe(1.25);
    expect(aggregate).toHaveBeenCalledWith({
      where: {
        orgId: "org1",
        operation: "contract_review",
        createdAt: { gte: utcDayStart(now) },
      },
      _sum: { estimatedCostUsd: true },
    });
    expect(utcDayStart(now).toISOString()).toBe("2026-08-28T00:00:00.000Z");
  });

  it("null/NaN não desligam o cap em silêncio — viram 0", async () => {
    aggregate.mockResolvedValue({ _sum: { estimatedCostUsd: null } });
    expect(await reviewSpentTodayUsd("org1", now)).toBe(0);
    aggregate.mockResolvedValue({ _sum: { estimatedCostUsd: "not-a-number" } });
    expect(await reviewSpentTodayUsd("org1", now)).toBe(0);
  });
});

describe("checkReviewDailyCap", () => {
  it("dentro do cap", async () => {
    aggregate.mockResolvedValue({ _sum: { estimatedCostUsd: "0.10" } });
    const check = await checkReviewDailyCap("org1");
    expect(check).toEqual({ withinCap: true, spentUsd: 0.1, capUsd: DEFAULT_REVIEW_DAILY_MAX_USD });
  });

  it("estourado (>= cap) bloqueia", async () => {
    process.env.CONTRACT_REVIEW_DAILY_MAX_USD = "0.10";
    aggregate.mockResolvedValue({ _sum: { estimatedCostUsd: "0.10" } });
    const check = await checkReviewDailyCap("org1");
    expect(check.withinCap).toBe(false);
  });
});
