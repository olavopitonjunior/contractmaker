import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db/prisma";

/**
 * O painel da biblioteca DELEGA à validação individual, e é isso que estes
 * casos protegem. A tentação de reimplementar as contagens aqui — mais rápida
 * de escrever — criaria uma segunda fonte de verdade sobre "dá para ativar?", e
 * o operador ficaria entre duas telas que discordam sem ter como decidir qual
 * está certa.
 */
const validateMock = vi.fn();
vi.mock("../validate-gdoc", () => ({
  validateGoogleDocTemplate: (...args: unknown[]) => validateMock(...args),
}));

import { reviewLibrary } from "../library-review";

const findMany = vi.fn();
Object.assign(prisma.contractTemplate, { findMany });

function modelo(over: Record<string, unknown> = {}) {
  return {
    id: "tpl1",
    orgId: "org1",
    name: "Locação residencial",
    engine: "google_docs",
    modalidade: "locacao",
    status: "draft",
    googleTemplateDocId: "doc1",
    handlebarsSource: "",
    sourceHash: "hash",
    draftReport: null,
    ...over,
  };
}

function validacao(over: Record<string, unknown> = {}) {
  return {
    docId: "doc1",
    found: [],
    unknown: [],
    missingRequired: [],
    slots: [],
    pii: { blocked: false, kinds: [], count: 0, warnings: [], checkedAt: "" },
    semantic: {
      findings: [],
      checkedAt: "",
      sourceAvailable: true,
      orgFactsAvailable: true,
    },
    catalog: [
      { token: "a", label: "", description: "", required: true, kind: "simple", present: true },
      { token: "b", label: "", description: "", required: false, kind: "simple", present: false },
    ],
    ...over,
  };
}

const ACHADO = {
  id: "f1",
  severity: "error" as const,
  category: "wrong-entity" as const,
  paragraphIndex: 3,
  excerpt: "a) R$ …",
  message: "chave da corretora onde cabia a da imobiliária",
  suggestedFix: {
    op: "rekey" as const,
    phrase: "…",
    fromToken: "corretagem_qualificacao",
    toToken: "imobiliaria_qualificacao",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("reviewLibrary", () => {
  it("delega a validação individual, passando o modelo e a org", async () => {
    findMany.mockResolvedValue([modelo()]);
    validateMock.mockResolvedValue(validacao());
    const { rows } = await reviewLibrary({ orgId: "org1" });
    expect(validateMock).toHaveBeenCalledWith({
      template: expect.objectContaining({ id: "tpl1" }),
      orgId: "org1",
    });
    expect(rows[0]!.chaves).toEqual({ presentes: 1, total: 2 });
    expect(rows[0]!.pronto).toBe(true);
  });

  it("Doc ilegível vira linha COM erro — não some da lista nem passa por limpo", async () => {
    findMany.mockResolvedValue([modelo()]);
    validateMock.mockRejectedValue(new Error("File not found: doc1"));
    const { rows } = await reviewLibrary({ orgId: "org1" });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.erro).toContain("File not found");
    expect(rows[0]!.pronto).toBe(false);
  });

  it("um Doc ilegível não derruba a revisão dos outros", async () => {
    findMany.mockResolvedValue([modelo({ id: "a" }), modelo({ id: "b" })]);
    validateMock
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(validacao());
    const { rows } = await reviewLibrary({ orgId: "org1" });
    expect(rows.map((r) => r.templateId)).toEqual(["a", "b"]);
    expect(rows[0]!.erro).toBeTruthy();
    expect(rows[1]!.pronto).toBe(true);
  });

  it("obrigatória faltando, PII e erro semântico cada um derruba o `pronto`", async () => {
    findMany.mockResolvedValue([modelo({ id: "a" }), modelo({ id: "b" }), modelo({ id: "c" })]);
    validateMock
      .mockResolvedValueOnce(validacao({ missingRequired: ["locador_qualificacao"] }))
      .mockResolvedValueOnce(
        validacao({ pii: { blocked: true, kinds: ["cpf"], count: 1, warnings: [], checkedAt: "" } })
      )
      .mockResolvedValueOnce(
        validacao({
          semantic: {
            findings: [ACHADO],
            checkedAt: "",
            sourceAvailable: true,
            orgFactsAvailable: true,
          },
        })
      );
    const { rows } = await reviewLibrary({ orgId: "org1" });
    expect(rows.map((r) => r.pronto)).toEqual([false, false, false]);
    expect(rows[2]!.consertaveis).toBe(1);
  });

  it("aviso semântico NÃO derruba o `pronto` — só erro trava a ativação", async () => {
    findMany.mockResolvedValue([modelo()]);
    validateMock.mockResolvedValue(
      validacao({
        semantic: {
          findings: [{ ...ACHADO, severity: "warning" as const }],
          checkedAt: "",
          sourceAvailable: true,
          orgFactsAvailable: true,
        },
      })
    );
    const { rows } = await reviewLibrary({ orgId: "org1" });
    expect(rows[0]!.pronto).toBe(true);
    expect(rows[0]!.achados).toHaveLength(1);
  });

  it("a FRASE do conserto não atravessa para o browser — só o verbo", async () => {
    // A máscara do excerto acontece na ORIGEM (`runSemanticChecks`, coberto no
    // teste daquele módulo); o que o painel acrescenta é não repassar as frases
    // cruas do conserto, que carregam trecho literal do contrato e para nada
    // servem na tela: o clique manda `findingId`, e o servidor recalcula a
    // frase contra o Doc de agora.
    findMany.mockResolvedValue([modelo()]);
    validateMock.mockResolvedValue(
      validacao({
        semantic: {
          findings: [ACHADO],
          checkedAt: "",
          sourceAvailable: true,
          orgFactsAvailable: true,
        },
      })
    );
    const { rows } = await reviewLibrary({ orgId: "org1" });
    const f = rows[0]!.achados[0]!;
    expect(f.suggestedFix).toEqual({ op: "rekey" });
    expect(JSON.stringify(rows)).not.toContain("corretagem_qualificacao");
  });

  it("trunca no teto e avisa", async () => {
    findMany.mockResolvedValue([modelo({ id: "a" }), modelo({ id: "b" })]);
    validateMock.mockResolvedValue(validacao());
    const { rows, truncado } = await reviewLibrary({ orgId: "org1", max: 1 });
    expect(rows).toHaveLength(1);
    expect(truncado).toBe(true);
    expect(validateMock).toHaveBeenCalledTimes(1);
  });

  it("pega ativos e rascunhos, nunca arquivados", async () => {
    findMany.mockResolvedValue([]);
    await reviewLibrary({ orgId: "org1" });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          orgId: "org1",
          engine: "google_docs",
          status: { not: "archived" },
        }),
      })
    );
  });
});
