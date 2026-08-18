import { describe, it, expect } from "vitest";
import { proposalDeadline } from "../deadline";

const NOW = new Date("2026-08-18T12:00:00-03:00").getTime();
const PAST = new Date(NOW - 5 * 86_400_000);
const IN_1D = new Date(NOW + 1 * 86_400_000);

describe("proposalDeadline", () => {
  it("proposta assinada (completa) com data vencida mostra 'assinada', não 'vencida'", () => {
    const d = proposalDeadline(PAST, "completa", NOW);
    expect(d.shortLabel).toBe("já assinada");
    expect(d.tone).toBe("none");
  });

  it("parcialmente assinada e convertida também congelam o prazo", () => {
    for (const status of ["assinada_proponente", "aguardando_vendedor", "convertida"]) {
      expect(proposalDeadline(PAST, status, NOW).shortLabel).toBe("já assinada");
    }
  });

  it("expirada mostra 'vencida' mesmo sem validUntil", () => {
    const d = proposalDeadline(null, "expirada", NOW);
    expect(d.label).toBe("vencida");
    expect(d.tone).toBe("danger");
  });

  it("terminais sem prazo relevante mostram '—'", () => {
    for (const status of ["cancelada", "recusada_proponente", "recusada_vendedor"]) {
      expect(proposalDeadline(PAST, status, NOW).shortLabel).toBe("—");
    }
  });

  it("enviada com D-1 conta normalmente", () => {
    const d = proposalDeadline(IN_1D, "enviada", NOW);
    expect(d.label).toBe("faltam 1d");
    expect(d.tone).toBe("warn");
  });

  it("enviada com data vencida segue 'vencida' (aí sim o prazo corre)", () => {
    expect(proposalDeadline(PAST, "enviada", NOW).label).toBe("vencida");
  });

  it("sem validUntil no pré-assinatura cai em 'sem prazo'", () => {
    const d = proposalDeadline(null, "rascunho", NOW);
    expect(d.label).toBe("sem prazo");
    expect(d.shortLabel).toBe("—");
  });
});
