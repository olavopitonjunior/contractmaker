import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildConsolidationPlan,
  buildDifferenceMatrix,
  containment,
  COMPARISON_MIN_CHARS,
  DEFAULT_CONTAINMENT_THRESHOLD,
  DEFAULT_SIMILARITY_THRESHOLD,
  groupSimilarDocs,
  MIN_SIZE_RATIO,
  normalizeDoc,
  primaryDifferenceRow,
  similarity,
  suggestGarantiaTipo,
  type NormalizedDoc,
} from "../consolidation";

/**
 * REGRESSÃO CONTRA O CORPUS REAL — 4 contratos residenciais da Ativa,
 * higienizados (nomes/CPFs/endereços trocados por um elenco fictício; o
 * relatório de build acusou zero ocorrências de PII e a verificação foi
 * repetida na cópia). São contratos PREENCHIDOS, não minutas em branco: é
 * justamente o que a imobiliária tem na pasta e sobe na central de ingestão.
 *
 * Os quatro são a MESMA locação residencial variando a garantia:
 *   01 fiador · 02 sem fiança · 03 seguro Porto Seguro · 04 título de capitalização
 *
 * O smoke original agrupava só 3: o Porto Seguro (que traz 6 cláusulas de rider
 * da seguradora) ficava de fora. Este arquivo trava as duas correções que
 * resolveram isso — a visão de comparação e o critério duplo — e o resultado
 * ponta a ponta do plano de consolidação.
 */

const DIR = join(__dirname, "fixtures", "ativa-residencial");

const FILES = {
  fiador: "01-RES-FIADOR.txt",
  semFianca: "02-RES-SEM-FIANCA.txt",
  portoSeguro: "03-RES-PORTO-SEGURO.txt",
  titulo: "04-RES-TITULO-CAPITALIZACAO.txt",
} as const;

type Slug = keyof typeof FILES;

function load(slug: Slug): NormalizedDoc {
  return normalizeDoc({
    id: slug,
    name: FILES[slug],
    family: "locacao",
    text: readFileSync(join(DIR, FILES[slug]), "utf8"),
  });
}

const ALL: NormalizedDoc[] = (Object.keys(FILES) as Slug[]).map(load);
const bySlug = Object.fromEntries(ALL.map((d) => [d.id, d])) as Record<
  Slug,
  NormalizedDoc
>;

describe("corpus Ativa — visão de comparação", () => {
  it("descarta o bloco de assinaturas (dado de instância), mantendo as cláusulas", () => {
    for (const doc of ALL) {
      // ~1/3 dos parágrafos de um contrato preenchido são linhas de assinatura
      // ("CPF 111…", "RG 12…", o nome de cada signatário) — ruído puro.
      expect(doc.compareKeys.length).toBeLessThan(doc.keys.length);
      expect(doc.compareKeys.length).toBeGreaterThan(doc.keys.length * 0.4);
    }
    // Nada de conteúdo é perdido: cláusula real tem centenas de caracteres.
    expect(COMPARISON_MIN_CHARS).toBeLessThan(80);
  });

  it("o plano continua enxergando o documento INTEIRO (o texto vai pro Doc)", () => {
    const doc = bySlug.fiador;
    expect(doc.paragraphs).toHaveLength(doc.keys.length);
    expect(doc.keys.length).toBeGreaterThan(doc.compareKeys.length);
  });
});

describe("corpus Ativa — agrupamento", () => {
  it("os 4 formam UM grupo só (o Porto Seguro não fica de fora)", () => {
    const groups = groupSimilarDocs(ALL);
    expect(groups).toHaveLength(1);
    expect([...groups[0].memberIds].sort()).toEqual([
      "fiador",
      "portoSeguro",
      "semFianca",
      "titulo",
    ]);
    expect(groups[0].linkedBy).toBe("dice");
  });

  it("REGRESSÃO: o rider da seguradora não deixa o Porto Seguro fora do grupo", () => {
    // O agrupamento é por LIGAÇÃO SIMPLES: basta UMA aresta que passe por algum
    // dos dois critérios pra o documento entrar (o resto vem por
    // transitividade). O Porto Seguro entra pelo "sem fiança"; a aresta direta
    // com o "fiador" é fraca — os dois têm blocos grandes e DIFERENTES.
    const edges = (["fiador", "semFianca", "titulo"] as Slug[]).map((other) => {
      const dice = similarity(bySlug.portoSeguro, bySlug[other]);
      const cont = containment(bySlug.portoSeguro, bySlug[other]);
      return {
        other,
        dice,
        cont,
        ok: dice >= DEFAULT_SIMILARITY_THRESHOLD || cont >= DEFAULT_CONTAINMENT_THRESHOLD,
      };
    });
    const linked = edges.filter((e) => e.ok);
    expect(
      linked.length,
      edges.map((e) => `${e.other} dice=${e.dice.toFixed(3)} cont=${e.cont.toFixed(3)}`).join(" | ")
    ).toBeGreaterThan(0);
    // Documenta QUEM é a ponte — se ela sumir numa mudança de normalização, o
    // teste do grupo único cai junto e a causa fica explícita aqui.
    expect(linked.map((e) => e.other)).toContain("semFianca");
  });

  it("as métricas do corpus ficam nas faixas medidas (detecta drift da normalização)", () => {
    // Piso do pior par observado — se algo na normalização regredir, cai aqui
    // antes de o agrupamento quebrar em produção.
    let worstDice = 1;
    for (let i = 0; i < ALL.length; i++) {
      for (let j = i + 1; j < ALL.length; j++) {
        worstDice = Math.min(worstDice, similarity(ALL[i], ALL[j]));
      }
    }
    expect(worstDice).toBeGreaterThan(0.65);
    expect(similarity(bySlug.semFianca, bySlug.titulo)).toBeGreaterThan(0.9);
  });

  it("a guarda de tamanho impede a contenção de casar um anexo com o contrato", () => {
    // Um trecho curto do contrato está 100% contido nele — e não é variante.
    const anexo = normalizeDoc({
      id: "anexo",
      name: "anexo.txt",
      family: "locacao",
      text: bySlug.fiador.paragraphs.slice(10, 14).join("\n"),
    });
    expect(containment(anexo, bySlug.fiador)).toBeGreaterThan(
      DEFAULT_CONTAINMENT_THRESHOLD
    );
    const groups = groupSimilarDocs([bySlug.fiador, anexo]);
    expect(groups).toHaveLength(0);
    expect(MIN_SIZE_RATIO).toBeGreaterThan(0);
  });

  it("a guarda de família continua valendo sobre o critério novo", () => {
    const proposta = normalizeDoc({
      id: "proposta",
      name: "proposta.txt",
      family: "proposta_locacao_residencial",
      text: readFileSync(join(DIR, FILES.fiador), "utf8"),
    });
    expect(groupSimilarDocs([bySlug.fiador, proposta])).toHaveLength(0);
  });
});

describe("corpus Ativa — plano de consolidação", () => {
  const group = groupSimilarDocs(ALL)[0];
  const members = group.memberIds.map((id) => bySlug[id as Slug]);
  const plan = buildConsolidationPlan(members);
  const primary = primaryDifferenceRow(buildDifferenceMatrix(plan))!;

  it("extrai uma base comum substancial", () => {
    expect(plan.commonParagraphs.length).toBeGreaterThan(30);
    const base = plan.commonParagraphs.join("\n");
    expect(base).toContain("CONTRATO DE LOCAÇÃO PARA FINS RESIDENCIAIS");
    // O que varia NÃO pode estar na base — senão vira texto fixo no template.
    expect(base).not.toMatch(/PORTO SEGURO/i);
    expect(base).not.toMatch(/T[ÍI]TULO DE CAPITALIZA/i);
    expect(base).not.toMatch(/CONDI[ÇC][ÃA]O DE FIADOR/i);
  });

  it("produz 4 variantes, uma por arquivo", () => {
    expect(plan.variants).toHaveLength(4);
    expect(plan.variants.map((v) => v.docId).sort()).toEqual(
      [...group.memberIds].sort()
    );
  });

  it("o bloco divergente de cada variante carrega o marcador da sua garantia", () => {
    const text = (slug: Slug) => (primary.byDoc[slug] ?? []).join("\n");
    expect(text("fiador")).toMatch(/FIADOR E DEVEDOR SOLID[ÁA]RIO/i);
    expect(text("portoSeguro")).toMatch(/PORTO SEGURO/i);
    expect(text("titulo")).toMatch(/T[ÍI]TULO DE CAPITALIZA[ÇC][ÃA]O/i);
  });

  it("a variante SEM fiança tem o bloco mínimo — não há cláusula de garantia", () => {
    const semFianca = primary.byDoc.semFianca ?? [];
    const outros = (["fiador", "portoSeguro", "titulo"] as Slug[]).map(
      (s) => (primary.byDoc[s] ?? []).join("\n").length
    );
    expect(semFianca).toHaveLength(1);
    for (const len of outros) {
      expect(len).toBeGreaterThan(semFianca.join("\n").length);
    }
  });

  it("o palpite determinístico acerta as três garantias reais", () => {
    expect(suggestGarantiaTipo((primary.byDoc.fiador ?? []).join("\n"))).toBe("fiador");
    expect(suggestGarantiaTipo((primary.byDoc.portoSeguro ?? []).join("\n"))).toBe(
      "seguro_fianca"
    );
    expect(suggestGarantiaTipo((primary.byDoc.titulo ?? []).join("\n"))).toBe(
      "titulo_capitalizacao"
    );
  });

  it("os blocos divergentes ancoram todos na mesma posição (é UM slot)", () => {
    const anchors = new Set(
      plan.variants.flatMap((v) =>
        v.blocks.filter((b) => b.anchorIndex === primary.anchorIndex).map((b) => b.anchorIndex)
      )
    );
    expect(anchors.size).toBe(1);
  });
});
