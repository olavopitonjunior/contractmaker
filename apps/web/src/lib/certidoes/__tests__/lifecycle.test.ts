import { describe, it, expect } from "vitest";
import {
  isInProgressBlocking,
  isRetryableError,
  STALE_DISPATCH_MS,
} from "../lifecycle";

const NOW = 1_780_000_000_000; // timestamp fixo (Date.now indisponível em testes determinísticos)

describe("isInProgressBlocking — trava por alvo", () => {
  it("pending/fetching recente bloqueia", () => {
    expect(
      isInProgressBlocking({ status: "fetching", createdAt: NOW - 60_000 }, NOW)
    ).toBe(true);
    expect(
      isInProgressBlocking({ status: "pending", createdAt: NOW - 1000 }, NOW)
    ).toBe(true);
  });

  it("pending/fetching velho (> 30 min) NÃO bloqueia — é travado, sweeper trata", () => {
    expect(
      isInProgressBlocking(
        { status: "fetching", createdAt: NOW - STALE_DISPATCH_MS - 1 },
        NOW
      )
    ).toBe(false);
  });

  it("awaiting_portal SAUDÁVEL (com numero_pedido) bloqueia", () => {
    expect(
      isInProgressBlocking(
        { status: "awaiting_portal", resultData: { numero_pedido: "97293658" } },
        NOW
      )
    ).toBe(true);
  });

  it("awaiting_portal ZUMBI (sem numero_pedido) NÃO bloqueia → retentável", () => {
    expect(isInProgressBlocking({ status: "awaiting_portal" }, NOW)).toBe(false);
    expect(
      isInProgressBlocking(
        { status: "awaiting_portal", resultData: { numero_pedido: "" } },
        NOW
      )
    ).toBe(false);
  });

  it("estados terminais (erros/sucesso) NÃO bloqueiam", () => {
    for (const status of [
      "failed",
      "failed_permanent",
      "data_missing",
      "data_invalid",
      "portal_unavailable",
      "success",
      "informativo",
      "skipped",
      "replaced",
    ]) {
      expect(isInProgressBlocking({ status }, NOW)).toBe(false);
    }
  });
});

describe("isRetryableError — alvos que o usuário pode re-disparar", () => {
  it("erros terminais e transitórios são retentáveis (incl. instabilidade)", () => {
    for (const status of [
      "failed",
      "failed_permanent",
      "data_missing",
      "data_invalid",
      "portal_unavailable",
      "rate_limited",
      "api_error",
    ]) {
      expect(isRetryableError({ status }, NOW)).toBe(true);
    }
  });

  it("sucesso SEM PDF é retentável (re-baixar); com PDF não", () => {
    expect(isRetryableError({ status: "success", attachmentId: null }, NOW)).toBe(true);
    expect(isRetryableError({ status: "success", attachmentId: "att_1" }, NOW)).toBe(
      false
    );
  });

  it("em andamento NÃO é retentável (não re-pedir o que aguarda o tribunal)", () => {
    expect(
      isRetryableError(
        { status: "awaiting_portal", resultData: { numero_pedido: "1" } },
        NOW
      )
    ).toBe(false);
    expect(
      isRetryableError({ status: "fetching", createdAt: NOW - 1000 }, NOW)
    ).toBe(false);
  });

  it("informativo / replaced / skipped não entram em 'erros'", () => {
    expect(isRetryableError({ status: "informativo" }, NOW)).toBe(false);
    expect(isRetryableError({ status: "replaced" }, NOW)).toBe(false);
    expect(isRetryableError({ status: "skipped" }, NOW)).toBe(false);
  });
});
