import { describe, it, expect } from "vitest";
import aprovado from "@/lib/certidoes/__tests__/fixtures/fichacerta-report-aprovado.json";
import comRestricao from "@/lib/certidoes/__tests__/fixtures/fichacerta-report-com-restricao.json";
import andamento from "@/lib/certidoes/__tests__/fixtures/fichacerta-report-andamento.json";
import webhook from "@/lib/certidoes/__tests__/fixtures/fichacerta-webhook-pretendente.json";
import pj from "@/lib/certidoes/__tests__/fixtures/fichacerta-report-pj.json";
import type { ReportResponse } from "../types";
import {
  isPretendenteConcluido,
  isPretendenteEmAndamento,
  normalizeFichaCertaLaudo,
  pretendenteUpdateKey,
  summarizeLaudo,
} from "../normalize";

const pret = (r: unknown, i = 0) => (r as ReportResponse).pretendentes![i];

describe("normalizeFichaCertaLaudo", () => {
  it("laudo limpo → sem_restricao, com score e parecer em detalhes", () => {
    const out = normalizeFichaCertaLaudo(pret(aprovado));
    expect(out.situacao).toBe("sem_restricao");
    expect(out.detalhes).toContain("Score FC 812");
    expect(out.detalhes).toContain("RISCO BAIXO");
    expect(out.detalhes).toContain("renda 3.1x");
    expect(out.emissao).toBe("2019-03-20 17:00:36");
    const raw = out.raw as ReturnType<typeof summarizeLaudo>;
    expect(raw.scoreFc).toBe(812);
    expect(raw.icons.restricoes_financeiras).toBe("positivo");
    expect(raw.restricoesInfo.protestos).toBe("NADA CONSTA");
  });

  it("restrição financeira negativa → com_restricao e nomeia o bloco", () => {
    const out = normalizeFichaCertaLaudo(pret(comRestricao));
    expect(out.situacao).toBe("com_restricao");
    expect(out.detalhes).toContain("restrições: protestos");
    expect(out.detalhes).toContain("RENDA INCOMPATÍVEL");
  });

  it("renda incompatível SOZINHA não vira restrição (é parecer, não restritivo)", () => {
    const p = JSON.parse(JSON.stringify(pret(comRestricao)));
    p.laudo.restricoes_financeiras.icon = "positivo";
    expect(normalizeFichaCertaLaudo(p).situacao).toBe("sem_restricao");
  });

  it("suspeita de óbito ou CPF irregular → com_restricao", () => {
    const p = JSON.parse(JSON.stringify(pret(aprovado)));
    p.laudo.suspeita_obito = { result: true, icon: "negativo" };
    expect(normalizeFichaCertaLaudo(p).situacao).toBe("com_restricao");
    const q = JSON.parse(JSON.stringify(pret(aprovado)));
    q.laudo.situacao_cpf = { result: "Suspenso", icon: "negativo" };
    expect(normalizeFichaCertaLaudo(q).situacao).toBe("com_restricao");
  });

  it("sem laudo ou só blocos nulos → indeterminado, nunca negativa", () => {
    expect(normalizeFichaCertaLaudo(pret(andamento)).situacao).toBe("indeterminado");
    const p = JSON.parse(JSON.stringify(pret(aprovado)));
    for (const k of ["restricoes_financeiras", "situacao_cpf", "suspeita_obito"]) p.laudo[k].icon = "nulo";
    const out = normalizeFichaCertaLaudo(p);
    expect(out.situacao).toBe("indeterminado");
    expect(out.detalhes).toContain("sem blocos de restrição");
  });

  it("shape mudado (icon desconhecido, blocos ausentes) cai em indeterminado", () => {
    const out = normalizeFichaCertaLaudo({ pessoa: { id: 1 }, laudo: { restricoes_financeiras: { icon: "verde" } } });
    expect(out.situacao).toBe("indeterminado");
  });

  it("pretendente PJ (FC EMPRESA, sem situacao_cpf/óbito) normaliza pelos blocos que existem", () => {
    const out = normalizeFichaCertaLaudo(pret(pj));
    expect(out.situacao).toBe("com_restricao");
    expect(out.detalhes).toContain("restrições: pendencias");
    expect(out.detalhes).toContain("Score FC 410");
    expect(isPretendenteConcluido(pret(pj))).toBe(true);
  });

  it("payload do webhook (só o pretendente concluído) normaliza igual ao GET", () => {
    const out = normalizeFichaCertaLaudo(pret(webhook));
    expect(out.situacao).toBe("sem_restricao");
    expect(out.detalhes).toContain("Score FC 540");
  });
});

describe("estado dos produtos e chave de idempotência", () => {
  it("concluído × em andamento", () => {
    expect(isPretendenteConcluido(pret(aprovado))).toBe(true);
    expect(isPretendenteConcluido(pret(comRestricao))).toBe(true);
    expect(isPretendenteConcluido(pret(andamento))).toBe(false);
    expect(isPretendenteEmAndamento(pret(andamento))).toBe(true);
    expect(isPretendenteEmAndamento(pret(aprovado))).toBe(false);
    expect(isPretendenteConcluido({ pessoa: { id: 1, produtos: [] } })).toBe(false);
  });

  it("chave = solicitação:pretendente:última data_atualizacao; reentrega gera a mesma", () => {
    const k1 = pretendenteUpdateKey(221, pret(comRestricao));
    expect(k1).toBe("221:573:2019-07-17 14:19:30");
    expect(pretendenteUpdateKey(221, JSON.parse(JSON.stringify(pret(comRestricao))))).toBe(k1);
    const reproc = JSON.parse(JSON.stringify(pret(comRestricao)));
    reproc.pessoa.produtos[0].data_atualizacao = "2019-07-18 10:00:00";
    expect(pretendenteUpdateKey(221, reproc)).not.toBe(k1);
  });
});
