/**
 * `POST /api/clauses/classify/apply` — a esteira FINAL decide contra qual
 * catálogo as chaves Handlebars do conteúdo são validadas, e se `groupCode`
 * pode existir.
 *
 * O bug (achado de review): `patch.esteira ?? current.esteira`. Aprovar
 * `esteira: null` — "desclassificar", que o schema aceita — fazia o `??` cair
 * de volta no valor ANTIGO do banco. O conteúdo tokenizado era então validado
 * contra o catálogo da esteira que a cláusula deixou de ter, e gravado. Falha
 * silenciosa: texto que o estado novo não renderiza.
 *
 * Correção: `"esteira" in patch`. Estes testes existem porque o `??` é
 * exatamente o tipo de coisa que alguém "simplifica" de volta em seis meses.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { POST } from "../classify/apply/route";

vi.mock("@/lib/ai/knowledge", () => ({
  updateKnowledgeItem: vi.fn().mockResolvedValue(undefined),
}));

import { updateKnowledgeItem } from "@/lib/ai/knowledge";

const mockPrisma = prisma as unknown as {
  knowledgeItem: { findFirst: ReturnType<typeof vi.fn> };
};

/** Conteúdo com chave que só existe no catálogo de VENDA. */
const CONTEUDO_VENDA = "O sinal de {{pagamento.sinal_valor}} será pago na assinatura.";

function req(items: unknown[]) {
  return new NextRequest("http://localhost/api/clauses/classify/apply", {
    method: "POST",
    body: JSON.stringify({ items }),
    headers: { "Content-Type": "application/json" },
  });
}

function clause(over: Record<string, unknown> = {}) {
  return {
    id: "cl1",
    orgId: "org-1",
    category: "clause",
    title: "Arras",
    content: "O sinal de R$ 50.000,00 será pago na assinatura.",
    tags: [],
    source: "manual",
    esteira: "venda",
    groupCode: "G1",
    subcategory: "sinal",
    agentNotes: null,
    isVariable: false,
    status: "approved",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u1" } });
  (getUserOrg as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "org-1" });
  mockPrisma.knowledgeItem.findFirst.mockResolvedValue(clause());
});

describe("apply — esteira aprovada como null", () => {
  it("NÃO grava conteúdo validado contra a esteira antiga", async () => {
    // Com o `??` de volta, `finalEsteira` seria "venda" e este conteúdo
    // passaria. Com o fix, a esteira final é null → sem catálogo → recusa.
    const res = await POST(
      req([
        {
          clauseId: "cl1",
          approve: { esteira: true, content: true },
          values: { esteira: null, content: CONTEUDO_VENDA },
        },
      ])
    );

    const body = await res.json();
    expect(body.applied).toEqual([]);
    expect(body.skipped).toEqual([{ clauseId: "cl1", reason: "chave_invalida" }]);
    expect(updateKnowledgeItem).not.toHaveBeenCalled();
  });

  it("MUTAÇÃO DE CONTROLE: a mesma aprovação SEM mexer na esteira passa", async () => {
    // Prova que a recusa acima vem do estado da esteira, e não de o conteúdo
    // ser inválido por outro motivo — sem isto o teste acima passaria à toa.
    const res = await POST(
      req([
        {
          clauseId: "cl1",
          approve: { content: true },
          values: { content: CONTEUDO_VENDA },
        },
      ])
    );

    const body = await res.json();
    expect(body.applied).toEqual(["cl1"]);
    expect(updateKnowledgeItem).toHaveBeenCalledWith(
      "cl1",
      "org-1",
      expect.objectContaining({ content: CONTEUDO_VENDA, isVariable: true })
    );
  });

  it("desclassificar sozinho limpa o groupCode junto", async () => {
    // G1..G6 só existe em compra e venda; deixar o grupo pendurado numa
    // cláusula sem esteira a esconderia da própria seção que a exibiria.
    const res = await POST(
      req([
        {
          clauseId: "cl1",
          approve: { esteira: true },
          values: { esteira: null },
        },
      ])
    );

    const body = await res.json();
    expect(body.applied).toEqual(["cl1"]);
    expect(updateKnowledgeItem).toHaveBeenCalledWith(
      "cl1",
      "org-1",
      expect.objectContaining({ esteira: null, groupCode: null })
    );
  });

  it("mudar para locação também limpa o grupo de venda", async () => {
    const res = await POST(
      req([
        {
          clauseId: "cl1",
          approve: { esteira: true },
          values: { esteira: "locacao" },
        },
      ])
    );

    const body = await res.json();
    expect(body.applied).toEqual(["cl1"]);
    expect(updateKnowledgeItem).toHaveBeenCalledWith(
      "cl1",
      "org-1",
      expect.objectContaining({ esteira: "locacao", groupCode: null })
    );
  });
});

describe("apply — fail-closed", () => {
  it("campo sem aprovação explícita não é gravado", async () => {
    const res = await POST(
      req([
        {
          clauseId: "cl1",
          approve: {},
          values: { subcategory: "posse", content: CONTEUDO_VENDA },
        },
      ])
    );

    const body = await res.json();
    expect(body.applied).toEqual([]);
    expect(body.skipped).toEqual([{ clauseId: "cl1", reason: "sem_alteracao" }]);
  });

  it("relê o congelamento de tags do BANCO, não do client", async () => {
    mockPrisma.knowledgeItem.findFirst.mockResolvedValue(
      clause({ source: "seed_curado", tags: ["slot:garantia", "garantia:caucao"] })
    );

    const res = await POST(
      req([
        {
          clauseId: "cl1",
          approve: { tags: true },
          values: { tags: ["slot:garantia", "garantia:caucao", "tema:garantia"] },
        },
      ])
    );

    const body = await res.json();
    expect(body.skipped).toEqual([{ clauseId: "cl1", reason: "tags_congeladas" }]);
    expect(updateKnowledgeItem).not.toHaveBeenCalled();
  });

  it("cláusula de outra org não é encontrada", async () => {
    mockPrisma.knowledgeItem.findFirst.mockResolvedValue(null);

    const res = await POST(
      req([{ clauseId: "cl1", approve: { subcategory: true }, values: { subcategory: "posse" } }])
    );

    const body = await res.json();
    expect(body.skipped).toEqual([{ clauseId: "cl1", reason: "nao_encontrada" }]);
  });
});
