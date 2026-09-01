/**
 * A busca de cláusula do agente passa a ser DIRECIONADA pela esteira do
 * contrato (compra e venda × locação). Estes testes travam as invariantes que,
 * se quebradas, produzem o pior bug possível aqui: "o agente não acha a
 * cláusula" — silencioso, e caríssimo de diagnosticar.
 *
 * As quatro invariantes:
 *  (a) `esteira IS NULL` SEMPRE passa — cláusula não triada não some;
 *  (b) sem sinal confiável de esteira, NÃO se filtra (fail-open);
 *  (c) `"ambas"` entra nas duas esteiras;
 *  (d) o filtro entra no MESMO `AND` do escopo — nunca espalhado ao lado, o que
 *      sobrescreveria o filtro de visibilidade por agente (furo de escopo real,
 *      cometido e pego pela suíte durante a implementação).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { loadExpertContext } from "../expert-context";
import { __resetAgentProfileCacheForTests } from "../agents/resolve";
import type { AgentContext } from "../types";
import { esteiraForContext } from "@/lib/clauses/taxonomy";

vi.mock("../memory", () => ({ findSimilarContracts: vi.fn().mockResolvedValue([]) }));

const mockPrisma = prisma as unknown as {
  knowledgeItem: { findMany: ReturnType<typeof vi.fn> };
  contractTemplate: { findMany: ReturnType<typeof vi.fn> };
  agentProfile: { findFirst: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> };
};

function ctxWith(over: Partial<Record<string, unknown>>): AgentContext {
  return {
    contractId: "c1",
    userId: "u1",
    orgId: "org-1",
    htmlContent: "",
    dataJson: {},
    templateSource: null,
    activeClauses: [],
    ...over,
  } as unknown as AgentContext;
}

/** Contexto como `buildAgentContext` o monta: esteira já resolvida dos crus. */
function ctxForContract(over: {
  dealKind?: string | null;
  templateModalidade?: string | null;
}): AgentContext {
  return ctxWith({
    // Espelha os defaults reais de `lib/ai/shared/context.ts` — é justamente
    // o que NÃO pode ser usado para decidir a esteira.
    templateModalidade: over.templateModalidade || "a_vista",
    dealKind: over.dealKind ?? "venda",
    esteira: esteiraForContext({
      dealKind: over.dealKind ?? null,
      templateModalidade: over.templateModalidade ?? null,
    }),
  });
}

function clauseAnd(): Record<string, unknown>[] {
  const where = mockPrisma.knowledgeItem.findMany.mock.calls[0]?.[0]?.where as Record<
    string,
    unknown
  >;
  return (where?.AND as Record<string, unknown>[]) ?? [];
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetAgentProfileCacheForTests();
  mockPrisma.knowledgeItem.findMany.mockResolvedValue([]);
  mockPrisma.contractTemplate.findMany.mockResolvedValue([]);
  mockPrisma.agentProfile.findFirst.mockResolvedValue(null);
  mockPrisma.agentProfile.findUnique.mockResolvedValue(null);
});

describe("expert-context filtra por esteira", () => {
  it("contrato de locação busca locacao + ambas, e deixa NULL passar", async () => {
    await loadExpertContext(ctxForContract({ templateModalidade: "locacao" }));
    const json = JSON.stringify(clauseAnd());
    expect(json).toContain('"esteira":null');
    expect(json).toContain("locacao");
    expect(json).toContain("ambas");
    expect(json).not.toContain('"venda"');
  });

  it("contrato de venda busca venda + ambas", async () => {
    await loadExpertContext(ctxForContract({ templateModalidade: "a_vista" }));
    const json = JSON.stringify(clauseAnd());
    expect(json).toContain('"venda"');
    expect(json).toContain("ambas");
    expect(json).toContain('"esteira":null');
  });

  it("administração de locação é LOCAÇÃO, apesar do nome", async () => {
    await loadExpertContext(ctxForContract({ templateModalidade: "administracao_locacao" }));
    const json = JSON.stringify(clauseAnd());
    expect(json).toContain('"locacao"');
    expect(json).not.toMatch(/"esteira":\{"in":\[[^\]]*"venda"/);
  });

  it("SEM sinal de esteira, não filtra nada (fail-open)", async () => {
    // `lib/ai/shared/context.ts` defaulta dealKind pra "venda"; se confiássemos
    // nisso, um contrato sem deal perderia o acervo de locação em silêncio.
    await loadExpertContext(ctxForContract({}));
    expect(JSON.stringify(clauseAnd())).not.toContain("esteira");
  });

  it("CONTRATO IMPORTADO de locação não é filtrado como venda", async () => {
    // A regressão: importado não tem template, `buildAgentContext` defaulta
    // `templateModalidade` para "a_vista", e calcular a esteira a partir daí
    // esconderia TODO o acervo de locação em toda conversa desse contrato.
    await loadExpertContext(ctxForContract({ dealKind: "locacao", templateModalidade: null }));
    const json = JSON.stringify(clauseAnd());
    expect(json).toContain('"locacao"');
    expect(json).not.toMatch(/"esteira":\{"in":\[[^\]]*"venda"/);
  });

  it("não substitui o AND do escopo — visibilidade por agente sobrevive", async () => {
    // Regressão: espalhar `{ AND: [...] }` ao lado de `knowledgeScopeWhere`
    // apagava o filtro de visibilidade. Os dois têm que coexistir.
    await loadExpertContext(ctxForContract({ templateModalidade: "locacao" }), "editor");
    const json = JSON.stringify(clauseAnd());
    expect(json).toContain("visibleToAgents");
    expect(json).toContain("esteira");
  });
});

describe("supressão de G4 continua valendo, mas só dentro de venda", () => {
  it("venda fora de financiamento esconde G4 SEM varrer groupCode nulo", async () => {
    // `groupCode: { not: "G4" }` excluiria NULL em SQL — a armadilha que o
    // código anterior já documentava. Tem que ser OR com null explícito.
    await loadExpertContext(ctxForContract({ templateModalidade: "a_vista" }));
    const json = JSON.stringify(clauseAnd());
    expect(json).toContain('"groupCode":null');
    expect(json).toContain("G5");
    expect(json).not.toContain('"G4"');
  });

  it("financiamento inclui G4", async () => {
    await loadExpertContext(ctxForContract({ templateModalidade: "financiamento" }));
    expect(JSON.stringify(clauseAnd())).not.toContain("G5"); // sem lista de supressão
  });

  it("locação nunca aplica a regra de G4 — não é o eixo dela", async () => {
    await loadExpertContext(ctxForContract({ templateModalidade: "locacao" }));
    expect(JSON.stringify(clauseAnd())).not.toContain("groupCode");
  });
});
