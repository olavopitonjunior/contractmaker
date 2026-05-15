/**
 * Testes regressivos pros normalizers Serasa.
 *
 * Por que regressivo: a Serasa renomeia/move campos sem aviso prévio (mesma
 * armadilha que Infosimples). As fixtures abaixo são snapshots manuais
 * curados — vai precisar atualizar quando o provider mudar shape, mas o
 * teste falha alto e claro nesse caso, evitando situações silenciosas onde
 * o normalizer começa a retornar `indeterminado` ou valores zero.
 */

import { describe, it, expect } from "vitest";
import { normalizeSerasa, normalizeScore, normalizeRestritivos, normalizeVinculos } from "../serasa-normalizers";

import scoreFixture from "./fixtures/serasa-score.json";
import restritivosClean from "./fixtures/serasa-restritivos-clean.json";
import restritivosWithDebt from "./fixtures/serasa-restritivos-with-debt.json";
import vinculosFixture from "./fixtures/serasa-vinculos.json";

describe("normalizeScore", () => {
  it("retorna situacao=informativa + detalhes com score legível", () => {
    const result = normalizeScore(scoreFixture);
    expect(result.situacao).toBe("informativa");
    expect(result.detalhes).toContain("754");
    expect(result.detalhes).toContain("risco");
    const raw = result.raw as Record<string, unknown>;
    expect(raw.score).toBe(754);
    expect(raw.faixa).toBe("baixo");
    expect(Array.isArray(raw.motivos)).toBe(true);
  });

  it("classifica risco quando provider nao manda faixa", () => {
    const result = normalizeScore({ score: 420 });
    expect(result.situacao).toBe("informativa");
    expect((result.raw as { faixa: string }).faixa).toBe("alto");
  });

  it("falha graciosamente quando shape mudou (sem campo score)", () => {
    const result = normalizeScore({ outraCoisa: 999 } as unknown as Record<string, never>);
    expect(result.situacao).toBe("indeterminado");
  });
});

describe("normalizeRestritivos", () => {
  it("sem ocorrencias → situacao=sem_restricao", () => {
    const result = normalizeRestritivos(restritivosClean);
    expect(result.situacao).toBe("sem_restricao");
    const raw = result.raw as Record<string, unknown>;
    expect(raw.totalOcorrencias).toBe(0);
  });

  it("com ocorrencias → situacao=com_restricao + agregacao no detalhes", () => {
    const result = normalizeRestritivos(restritivosWithDebt);
    expect(result.situacao).toBe("com_restricao");
    expect(result.detalhes).toContain("3 ocorrencias");
    expect(result.detalhes).toContain("protesto");
    expect(result.detalhes).toContain("pendencia");
    const raw = result.raw as Record<string, unknown>;
    expect(raw.totalOcorrencias).toBe(3);
    expect(raw.valorTotal).toBeCloseTo(12450.55);
  });

  it("computa totalOcorrencias do tamanho das listas quando provider omite", () => {
    const result = normalizeRestritivos({
      pendencias: [{ tipo: "Pefin", valor: 100 }],
      protestos: [],
      acoes: [],
      chequesSemFundo: [],
    });
    expect(result.situacao).toBe("com_restricao");
    expect((result.raw as { totalOcorrencias: number }).totalOcorrencias).toBe(1);
  });
});

describe("normalizeVinculos", () => {
  it("retorna lista de vínculos no raw + situacao=informativa", () => {
    const result = normalizeVinculos(vinculosFixture);
    expect(result.situacao).toBe("informativa");
    expect(result.detalhes).toContain("2");
    const raw = result.raw as Record<string, unknown>;
    expect((raw.vinculos as unknown[]).length).toBe(2);
    expect((raw.vinculos as Array<{ cnpj: string }>)[0].cnpj).toBe("12345678000190");
  });

  it("lista vazia → detalhes amigável", () => {
    const result = normalizeVinculos({ vinculos: [], totalVinculos: 0 });
    expect(result.situacao).toBe("informativa");
    expect(result.detalhes?.toLowerCase()).toContain("nenhum");
  });
});

describe("normalizeSerasa (dispatcher)", () => {
  it("roteia score-pf para normalizeScore", () => {
    expect(normalizeSerasa("serasa/score-pf", scoreFixture).situacao).toBe("informativa");
  });
  it("roteia restritivos-pj para normalizeRestritivos", () => {
    expect(normalizeSerasa("serasa/restritivos-pj", restritivosClean).situacao).toBe("sem_restricao");
  });
  it("roteia vinculos-pj-pf para normalizeVinculos", () => {
    expect(normalizeSerasa("serasa/vinculos-pj-pf", vinculosFixture).situacao).toBe("informativa");
  });
  it("retorna indeterminado pra endpoint desconhecido", () => {
    const result = normalizeSerasa("serasa/inexistente", {});
    expect(result.situacao).toBe("indeterminado");
  });
});
