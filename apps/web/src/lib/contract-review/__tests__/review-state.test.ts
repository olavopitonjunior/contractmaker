import { describe, expect, it } from "vitest";
import {
  REVIEW_MAX_ATTEMPTS,
  REVIEW_STALE_MS,
  canTransition,
  isClaimable,
  isReviewStatus,
  isTerminalReviewStatus,
  reviewClaimWhere,
} from "../review-state";

describe("canTransition", () => {
  it("caminho feliz: queued → reviewing → done", () => {
    expect(canTransition("queued", "reviewing")).toBe(true);
    expect(canTransition("reviewing", "done")).toBe(true);
  });

  it("reviewing → queued (Drive caiu, devolve pro sweeper)", () => {
    expect(canTransition("reviewing", "queued")).toBe(true);
  });

  it("failed/skipped alcançáveis de qualquer estado vivo", () => {
    expect(canTransition("queued", "failed")).toBe(true);
    expect(canTransition("queued", "skipped")).toBe(true);
    expect(canTransition("reviewing", "failed")).toBe(true);
    expect(canTransition("reviewing", "skipped")).toBe(true);
  });

  it("permanecer no mesmo estado vivo é válido (re-claim de stale)", () => {
    expect(canTransition("reviewing", "reviewing")).toBe(true);
    expect(canTransition("queued", "queued")).toBe(true);
  });

  it("terminal não sai", () => {
    expect(canTransition("done", "reviewing")).toBe(false);
    expect(canTransition("failed", "queued")).toBe(false);
    expect(canTransition("skipped", "skipped")).toBe(false);
  });

  it("queued não pula direto pra done", () => {
    expect(canTransition("queued", "done")).toBe(false);
  });
});

describe("claim", () => {
  const now = new Date("2026-08-28T12:00:00Z");

  it("where restringe a queued/reviewing com startedAt livre ou vencido", () => {
    const where = reviewClaimWhere({ runId: "r1", now });
    expect(where.id).toBe("r1");
    expect(where.status.in).toEqual(["queued", "reviewing"]);
    expect(where.OR[0]).toEqual({ startedAt: null });
    expect(where.OR[1].startedAt.lt.getTime()).toBe(now.getTime() - REVIEW_STALE_MS);
  });

  it("isClaimable espelha o where", () => {
    expect(isClaimable({ status: "queued", startedAt: null }, now)).toBe(true);
    expect(
      isClaimable({ status: "reviewing", startedAt: new Date(now.getTime() - REVIEW_STALE_MS - 1) }, now)
    ).toBe(true);
    // Worker vivo: claim recente não é roubado.
    expect(
      isClaimable({ status: "reviewing", startedAt: new Date(now.getTime() - 1000) }, now)
    ).toBe(false);
    expect(isClaimable({ status: "done", startedAt: null }, now)).toBe(false);
  });
});

describe("guards de tipo", () => {
  it("isReviewStatus / isTerminalReviewStatus", () => {
    expect(isReviewStatus("queued")).toBe(true);
    expect(isReviewStatus("extracting")).toBe(false);
    expect(isTerminalReviewStatus("skipped")).toBe(true);
    expect(isTerminalReviewStatus("reviewing")).toBe(false);
  });

  it("stale > maxDuration da rota (300s) e tentativas limitadas", () => {
    expect(REVIEW_STALE_MS).toBeGreaterThan(300_000);
    expect(REVIEW_MAX_ATTEMPTS).toBe(3);
  });
});
