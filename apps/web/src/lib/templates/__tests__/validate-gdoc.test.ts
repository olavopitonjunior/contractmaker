import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db/prisma";

/**
 * A revalidação passou a ter duas entradas que a validação sintática nunca
 * teve: o cadastro da própria imobiliária e o texto do contrato ORIGINAL. Este
 * teste fixa como elas são buscadas (não há FK: a junção é `sourceHash` +
 * `run.orgId`) e o que sobra gravado no relatório — que é lido na tela e vai
 * para o jsonb, e por isso não pode carregar frase crua de contrato.
 */
const getDocPlainTextMock = vi.fn();
vi.mock("@/lib/google/docs", () => ({
  getDocPlainText: (...args: unknown[]) => getDocPlainTextMock(...args),
}));

import { validateGoogleDocTemplate } from "../validate-gdoc";

const templateUpdate = vi.fn();
const orgFindUnique = vi.fn();
const itemFindFirst = vi.fn();
Object.assign(prisma.contractTemplate, { update: templateUpdate });
Object.assign(prisma.organization, { findUnique: orgFindUnique });
Object.assign(prisma.ingestionItem, { findFirst: itemFindFirst });

const HEADER = "<!-- engine=google_docs: a fonte é o Google Doc -->";

const ITEM_A =
  "a) R$ 2.500,00 (dois mil e quinhentos reais), a ser pago diretamente à imobiliária intermediadora Trio, como honorários pela intermediação;";
const ABRE = "4.1.1. O pagamento correspondente ao primeiro aluguel será rateado da seguinte forma:";
const FECHA = "4.1.2. Os valores acima serão retidos pela ADMINISTRADORA no primeiro repasse.";

function template(over: Record<string, unknown> = {}) {
  return {
    id: "tpl1",
    orgId: "org1",
    engine: "google_docs",
    googleTemplateDocId: "doc1",
    modalidade: "locacao",
    handlebarsSource: HEADER,
    sourceHash: "hash-do-docx",
    draftReport: null,
    ...over,
  };
}

const savedReport = () =>
  templateUpdate.mock.calls.at(-1)?.[0].data.draftReport as Record<string, unknown>;

describe("validateGoogleDocTemplate — checagem semântica", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    templateUpdate.mockResolvedValue({});
    orgFindUnique.mockResolvedValue(null);
    itemFindFirst.mockResolvedValue(null);
  });

  it("busca o contrato original pelo sourceHash dentro da org, sem depender do status do lote", async () => {
    getDocPlainTextMock.mockResolvedValue([ABRE, "{{imobiliaria_qualificacao}}", FECHA].join("\n"));
    itemFindFirst.mockResolvedValue({ text: [ABRE, ITEM_A, FECHA].join("\n") });

    const result = await validateGoogleDocTemplate({ template: template(), orgId: "org1" });

    expect(itemFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sourceHash: "hash-do-docx", run: { orgId: "org1" } },
      })
    );
    expect(result.semantic.sourceAvailable).toBe(true);
    const collapsed = result.semantic.findings.find((f) => f.category === "collapsed-paragraph");
    expect(collapsed?.severity).toBe("error");
    // O conserto vem com o texto do fonte — quem aplica precisa dele.
    expect(collapsed?.suggestedFix).toEqual({
      op: "restore-paragraph",
      current: "{{imobiliaria_qualificacao}}",
      source: ITEM_A,
    });
  });

  it("não procura fonte quando o modelo não tem sourceHash", async () => {
    getDocPlainTextMock.mockResolvedValue("Contrato simples sem chaves.");
    const result = await validateGoogleDocTemplate({
      template: template({ sourceHash: null }),
      orgId: "org1",
    });
    expect(itemFindFirst).not.toHaveBeenCalled();
    expect(result.semantic.sourceAvailable).toBe(false);
  });

  it("grava o relatório sem as frases do conserto, mantendo o verbo e o excerto", async () => {
    getDocPlainTextMock.mockResolvedValue([ABRE, "{{imobiliaria_qualificacao}}", FECHA].join("\n"));
    itemFindFirst.mockResolvedValue({ text: [ABRE, ITEM_A, FECHA].join("\n") });

    await validateGoogleDocTemplate({ template: template(), orgId: "org1" });

    const saved = savedReport();
    const semantic = saved.semantic as { findings: Array<Record<string, unknown>> };
    const fix = semantic.findings[0].suggestedFix as Record<string, unknown>;
    // Só o verbo: o texto que o aplicador precisa vem na resposta HTTP, não do jsonb.
    expect(fix).toEqual({ op: "restore-paragraph" });
    // O excerto FICA (é o que mostra na tela o que se perdeu), mascarado e cortado.
    expect(String(semantic.findings[0].excerpt).length).toBeLessThanOrEqual(240);
  });

  it("mascara dado pessoal no excerto gravado", async () => {
    const itemComCpf =
      "a) R$ 2.500,00, a ser pago diretamente à imobiliária intermediadora Trio, CPF 529.982.247-25, pela intermediação;";
    getDocPlainTextMock.mockResolvedValue([ABRE, "{{imobiliaria_qualificacao}}", FECHA].join("\n"));
    itemFindFirst.mockResolvedValue({ text: [ABRE, itemComCpf, FECHA].join("\n") });

    await validateGoogleDocTemplate({ template: template(), orgId: "org1" });

    expect(JSON.stringify(savedReport().semantic)).not.toContain("529.982.247-25");
  });

  it("usa o cadastro da org e diz quando ele não existe", async () => {
    getDocPlainTextMock.mockResolvedValue("A ADMINISTRADORA, CNPJ 12.345.678/0001-90, declara.");

    const semAcesso = await validateGoogleDocTemplate({ template: template(), orgId: "org1" });
    expect(semAcesso.semantic.orgFactsAvailable).toBe(false);
    expect(semAcesso.semantic.findings.some((f) => f.category === "org-literal")).toBe(false);

    orgFindUnique.mockResolvedValue({ cnpj: "12345678000190" });
    const comCadastro = await validateGoogleDocTemplate({ template: template(), orgId: "org1" });
    expect(comCadastro.semantic.orgFactsAvailable).toBe(true);
    expect(comCadastro.semantic.findings.some((f) => f.category === "org-literal")).toBe(true);
  });

  it("o update é escopado pela org (defesa em profundidade)", async () => {
    getDocPlainTextMock.mockResolvedValue("texto");
    await validateGoogleDocTemplate({ template: template(), orgId: "org1" });
    expect(templateUpdate.mock.calls.at(-1)?.[0].where).toEqual({ id: "tpl1", orgId: "org1" });
  });
});
