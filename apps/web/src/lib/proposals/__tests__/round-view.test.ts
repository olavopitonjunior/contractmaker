import { describe, it, expect } from "vitest";
import { proposalRoundView, ROUND_LABELS, type ProposalRound } from "../round-view";
import {
  TERMINAL_STATUSES,
  CONVERTABLE_STATUSES,
  CONVERT_UNSIGNED_STATUSES,
  SEND_VENDEDOR_STATUSES,
  AWAITING_DECISION_STATUSES,
  LIVE_POLL_STATUSES,
  AWAITING_SIGNATURE_STATUSES,
} from "../status-sets";
import { TERMINAL, ALLOWED_FROM } from "../status";

describe("proposalRoundView", () => {
  const round = (status: string, hasActiveVendedorVia = false) =>
    proposalRoundView({ status, hasActiveVendedorVia });

  it("1ª via cobre rascunho→visualizada + falha_envio", () => {
    for (const s of [
      "rascunho",
      "aguardando_aprovacao",
      "falha_envio",
      "enviada",
      "entregue",
      "visualizada",
    ]) {
      expect(round(s)).toBe("primeira_via");
    }
  });

  it("parada de decisão", () => {
    expect(round("assinada_proponente")).toBe("decisao");
  });

  it("aguardando_vendedor com via viva = enviada; sem via = falhou", () => {
    expect(round("aguardando_vendedor", true)).toBe("segunda_via_enviada");
    expect(round("aguardando_vendedor", false)).toBe("segunda_via_falhou");
  });

  it("completa/convertida = concluída; terminais negativos = encerrada", () => {
    expect(round("completa")).toBe("concluida");
    expect(round("convertida")).toBe("concluida");
    for (const s of ["recusada_proponente", "recusada_vendedor", "expirada", "cancelada"]) {
      expect(round(s)).toBe("encerrada");
    }
  });

  it("status desconhecido cai em encerrada (não explode a lista)", () => {
    expect(round("status_de_marte")).toBe("encerrada");
  });

  it("todo round tem label", () => {
    const all: ProposalRound[] = [
      "primeira_via",
      "decisao",
      "segunda_via_enviada",
      "segunda_via_falhou",
      "concluida",
      "encerrada",
    ];
    for (const r of all) expect(ROUND_LABELS[r]).toBeTruthy();
  });
});

describe("paridade e coerência dos sets (status-sets × status.ts)", () => {
  it("TERMINAL_STATUSES espelha TERMINAL exatamente", () => {
    expect(new Set(TERMINAL)).toEqual(TERMINAL_STATUSES);
  });

  it("CONVERTABLE só contém `completa` (o executor exige completa)", () => {
    expect([...CONVERTABLE_STATUSES]).toEqual(["completa"]);
  });

  it("CONVERTABLE e CONVERT_UNSIGNED são disjuntos", () => {
    for (const s of CONVERTABLE_STATUSES) {
      expect(CONVERT_UNSIGNED_STATUSES.has(s)).toBe(false);
    }
  });

  it("os statuses convertíveis-sem-assinatura são predecessores de `convertida` ou pré-envio", () => {
    // Tudo em CONVERT_UNSIGNED precisa de allowUnsigned; a máquina aceita
    // convertida a partir de completa/assinada_proponente/aguardando_vendedor —
    // os demais são convertidos pelo executor via caminho unsigned (sem CAS de
    // convertida a partir deles? Não: convert grava via updateMany direto).
    // O que o teste trava: assinada_proponente/aguardando_vendedor PRECISAM
    // estar em ALLOWED_FROM.convertida (o plano depende dessa aresta).
    expect(ALLOWED_FROM.convertida).toContain("assinada_proponente");
    expect(ALLOWED_FROM.convertida).toContain("aguardando_vendedor");
  });

  it("parada de decisão NÃO está no polling nem em 'aguardando assinatura'", () => {
    expect(LIVE_POLL_STATUSES.has("assinada_proponente")).toBe(false);
    expect(AWAITING_SIGNATURE_STATUSES.has("assinada_proponente")).toBe(false);
    expect(AWAITING_DECISION_STATUSES.has("assinada_proponente")).toBe(true);
  });

  it("send-vendedor é válido na parada e no retry de aguardando_vendedor", () => {
    expect([...SEND_VENDEDOR_STATUSES].sort()).toEqual([
      "aguardando_vendedor",
      "assinada_proponente",
    ]);
  });
});
