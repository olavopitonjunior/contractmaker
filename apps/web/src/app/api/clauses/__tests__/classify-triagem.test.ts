/**
 * `POST /api/clauses/classify` — "o modelo não decidiu" ≠ "já classificada"
 * (issue #480).
 *
 * `buildProposal` devolve `null` quando nenhum campo muda. Para uma cláusula do
 * balde de triagem (`esteira: null`), o modelo que não consegue decidir a
 * esteira pelo texto não muda campo nenhum — e a resposta caía em `unchanged`,
 * que a tela traduz como "as cláusulas selecionadas já estão classificadas".
 *
 * O efeito era uma cláusula presa em triagem para sempre: ela aparece nas duas
 * abas, a seção instrui a usar "Analisar e classificar", e a única ação
 * oferecida responde que não há nada a fazer.
 *
 * `undecided` sai de DENTRO de `unchanged`; a soma dos baldes continua fechando
 * com o lote elegível.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { classifyOneClause } from "@/lib/clauses/classifier-llm";
import { POST } from "../classify/route";

vi.mock("@/lib/ai/budget", () => ({
  getOrgAiBudgetStatus: vi
    .fn()
    .mockResolvedValue({ budgetUsd: null, spentUsd: 0 }),
}));
vi.mock("@/lib/ingestion/pii", () => ({ detectPii: vi.fn().mockReturnValue([]) }));
vi.mock("@/lib/clauses/classifier-llm", () => ({ classifyOneClause: vi.fn() }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const p = prisma as any;
const classify = vi.mocked(classifyOneClause);

function clause(id: string, esteira: string | null) {
  return {
    id,
    title: `Cláusula ${id}`,
    content: "conteúdo",
    tags: [],
    source: "manual",
    esteira,
    groupCode: null,
    subcategory: null,
    agentNotes: null,
    isVariable: false,
    _count: { contractClauses: 0 },
  };
}

function req(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/clauses/classify", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    user: { id: "u1" },
  });
  (getUserOrg as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "org-1",
  });
});

describe("POST /api/clauses/classify — abstenção na triagem (#480)", () => {
  it("cláusula SEM esteira sem proposta cai em `undecided`, não em `unchanged`", async () => {
    p.knowledgeItem.findMany.mockResolvedValue([clause("n1", null)]);
    classify.mockResolvedValue({ proposal: null } as never);

    const res = await POST(req({ clauseIds: ["n1"], esteira: "venda" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.undecided).toEqual(["n1"]);
    expect(body.unchanged).toEqual([]);
  });

  /**
   * CONTROLE. Sem ele, jogar TUDO em `undecided` passaria no teste acima e a
   * tela passaria a dizer "não consegui decidir" sobre cláusula que já está
   * classificada e apenas não precisa de mudança.
   */
  it("cláusula COM esteira sem proposta continua em `unchanged`", async () => {
    p.knowledgeItem.findMany.mockResolvedValue([clause("v1", "venda")]);
    classify.mockResolvedValue({ proposal: null } as never);

    const res = await POST(req({ clauseIds: ["v1"], esteira: "venda" }));
    const body = await res.json();

    expect(body.unchanged).toEqual(["v1"]);
    expect(body.undecided).toEqual([]);
  });

  /**
   * O outro CONTROLE: quando o modelo DECIDE, a cláusula sem esteira vira
   * proposta normal e não entra em balde nenhum. Sem isto, um `undecided` que
   * capturasse toda cláusula de esteira nula passaria despercebido.
   */
  it("cláusula sem esteira COM proposta não entra em `undecided`", async () => {
    p.knowledgeItem.findMany.mockResolvedValue([clause("n1", null)]);
    classify.mockResolvedValue({
      proposal: {
        clauseId: "n1",
        version: 1,
        title: "Cláusula n1",
        fields: { esteira: { current: null, proposed: "locacao" } },
        warnings: [],
        reason: "texto fala em aluguel",
      },
    } as never);

    const res = await POST(req({ clauseIds: ["n1"], esteira: "locacao" }));
    const body = await res.json();

    expect(body.proposals).toHaveLength(1);
    expect(body.undecided).toEqual([]);
    expect(body.unchanged).toEqual([]);
  });

  it("os baldes somam o lote elegível — nada se perde no caminho", async () => {
    p.knowledgeItem.findMany.mockResolvedValue([
      clause("n1", null),
      clause("v1", "venda"),
      clause("l1", "locacao"),
    ]);
    classify.mockResolvedValue({ proposal: null } as never);

    const res = await POST(req({ clauseIds: ["n1", "v1", "l1"], esteira: "venda" }));
    const body = await res.json();

    const total =
      body.proposals.length +
      body.unchanged.length +
      body.undecided.length +
      body.failures.length +
      body.ignored.length;
    expect(total).toBe(3);
    expect(body.ignored).toEqual(["l1"]);
  });
});
