import { describe, it, expect } from "vitest";
import { buildGroupingReport, type GroupableItem } from "@/lib/ingestion/grouping";

const LOCACAO_FIADOR = "contrato_locacao:locacao:fiador";
const LOCACAO_CAUCAO = "contrato_locacao:locacao:caucao";
const LOCACAO_SEGURO = "contrato_locacao:locacao:seguro_fianca";

/**
 * Base comum longa o bastante pra passar do piso de 40 chars da visão de
 * comparação (`COMPARISON_MIN_CHARS`) — parágrafo curto não conta como conteúdo.
 */
const BASE = [
  "CLÁUSULA PRIMEIRA - DO OBJETO. A presente locação recai sobre o imóvel residencial adiante descrito e caracterizado.",
  "CLÁUSULA SEGUNDA - DO PRAZO. O prazo da locação é de trinta meses, iniciando-se na data da assinatura deste instrumento.",
  "CLÁUSULA TERCEIRA - DO ALUGUEL. O aluguel mensal será pago até o quinto dia útil do mês subsequente ao vencido.",
  "CLÁUSULA QUARTA - DOS ENCARGOS. Correrão por conta do locatário as despesas ordinárias de condomínio e o IPTU do imóvel.",
  "CLÁUSULA QUINTA - DA CONSERVAÇÃO. O locatário obriga-se a conservar o imóvel e a devolvê-lo no estado em que o recebeu.",
  "CLÁUSULA SEXTA - DA RESCISÃO. A infração de qualquer cláusula deste contrato autoriza a rescisão de pleno direito.",
];

function doc(extra: string): string {
  return [...BASE, extra].join("\n");
}

function item(
  id: string,
  familyKey: string,
  extra = "CLÁUSULA SÉTIMA - DO FORO. Fica eleito o foro da situação do imóvel para dirimir as controvérsias."
): GroupableItem {
  return { id, filename: `${id}.docx`, text: doc(extra), familyKey };
}

describe("agrupamento por família fina", () => {
  it("agrupa documentos quase idênticos da MESMA família", () => {
    const report = buildGroupingReport([
      item("a", LOCACAO_SEGURO, "CLÁUSULA SÉTIMA - DA GARANTIA. Seguro fiança contratado junto à Porto Seguro, conforme a apólice anexa."),
      item("b", LOCACAO_SEGURO, "CLÁUSULA SÉTIMA - DA GARANTIA. Seguro fiança contratado junto à Tokio Marine, conforme a apólice anexa."),
    ]);

    expect(report.groups).toHaveLength(1);
    expect(report.groups[0].memberIds.sort()).toEqual(["a", "b"]);
    expect(report.groups[0].familyKey).toBe(LOCACAO_SEGURO);
    expect(report.singles).toEqual([]);
  });

  it("NUNCA agrupa garantias distintas, por mais parecido que o texto seja", () => {
    // Textos idênticos exceto a cláusula de garantia: se a chave não separasse,
    // eles agrupariam com similaridade altíssima.
    const report = buildGroupingReport([
      item("fiador", LOCACAO_FIADOR, "CLÁUSULA SÉTIMA - DA GARANTIA. A locação é garantida por fiador solidário."),
      item("caucao", LOCACAO_CAUCAO, "CLÁUSULA SÉTIMA - DA GARANTIA. A locação é garantida por caução em dinheiro."),
    ]);

    expect(report.groups).toEqual([]);
    expect(report.singles.sort()).toEqual(["caucao", "fiador"]);
    expect(report.families.map((f) => f.familyKey).sort()).toEqual([
      LOCACAO_CAUCAO,
      LOCACAO_FIADOR,
    ]);
  });

  it("isola a maior divergência como candidata a slot, uma coluna por membro", () => {
    const report = buildGroupingReport([
      item("a", LOCACAO_SEGURO, "CLÁUSULA SÉTIMA - DA GARANTIA. Seguro fiança contratado junto à Porto Seguro, conforme a apólice anexa a este instrumento."),
      item("b", LOCACAO_SEGURO, "CLÁUSULA SÉTIMA - DA GARANTIA. Seguro fiança contratado junto à Pottencial, conforme a apólice anexa a este instrumento."),
    ]);

    const primary = report.groups[0].primary;
    expect(primary).not.toBeNull();
    expect(Object.keys(primary!.byItem).sort()).toEqual(["a", "b"]);
    expect(primary!.byItem.a.join(" ")).toContain("Porto Seguro");
    expect(primary!.byItem.b.join(" ")).toContain("Pottencial");
  });

  it("documento sem texto não entra em família nenhuma", () => {
    const report = buildGroupingReport([
      item("a", LOCACAO_SEGURO),
      { id: "vazio", filename: "vazio.docx", text: "   ", familyKey: LOCACAO_SEGURO },
    ]);
    expect(report.families[0].itemIds).toEqual(["a"]);
    expect(report.singles).toEqual(["a"]);
  });

  it("lote vazio produz relatório vazio, não erro", () => {
    const report = buildGroupingReport([]);
    expect(report).toMatchObject({ families: [], groups: [], singles: [] });
    expect(report.groupedAt).toBeTruthy();
  });

  it("é serializável em Json — é o que vai pro report do run", () => {
    const report = buildGroupingReport([
      item("a", LOCACAO_SEGURO, "CLÁUSULA SÉTIMA - DA GARANTIA. Seguro fiança da Porto Seguro, conforme a apólice anexa a este instrumento."),
      item("b", LOCACAO_SEGURO, "CLÁUSULA SÉTIMA - DA GARANTIA. Seguro fiança da Pottencial, conforme a apólice anexa a este instrumento."),
    ]);
    expect(() => JSON.parse(JSON.stringify(report))).not.toThrow();
  });
});
