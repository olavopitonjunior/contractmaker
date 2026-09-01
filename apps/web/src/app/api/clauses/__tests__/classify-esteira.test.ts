/**
 * `POST /api/clauses/classify` — a esteira pedida recorta o lote (issue #479).
 *
 * O bug era de UI: a seleção sobrevivia à troca de esteira, e um lote disparado
 * na Locação levava junto uma cláusula de venda que o usuário não via. Limpar a
 * seleção conserta a tela, mas a rota aceitava qualquer id da org — um cliente
 * de API repetia o estrago sem passar por ela.
 *
 * Contrato desta guarda:
 * - `esteira` é OPCIONAL. Ausente = comportamento de antes, sem recorte.
 * - Cláusula SEM esteira (`null`) NÃO é descartada: a tela a exibe nas duas,
 *   e classificá-la é justamente o que tira ela da triagem.
 * - Nenhum status code novo ou alterado. Um lote inteiro fora da esteira volta
 *   200 com `proposals: []`, não 404 — o 404 continua sendo só "nada existe na
 *   org", que é o que ele sempre significou.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { classifyOneClause } from "@/lib/clauses/classifier-llm";
import { POST } from "../classify/route";

vi.mock("@/lib/ai/budget", () => ({
  getOrgAiBudgetStatus: vi.fn().mockResolvedValue({ budgetUsd: null, spentUsd: 0 }),
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

/** Ids que de fato chegaram ao classificador — é o que prova o recorte. */
function idsClassificados() {
  return classify.mock.calls.map((c) => (c[0] as { clause: { id: string } }).clause.id);
}

beforeEach(() => {
  vi.clearAllMocks();
  (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u1" } });
  (getUserOrg as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "org-1" });
  classify.mockResolvedValue({ proposal: null } as never);
});

describe("POST /api/clauses/classify — recorte por esteira (#479)", () => {
  it("DESCARTA a cláusula de outra esteira e a devolve em `ignored`", async () => {
    p.knowledgeItem.findMany.mockResolvedValue([
      clause("loc1", "locacao"),
      clause("ven1", "venda"),
    ]);

    const res = await POST(req({ clauseIds: ["loc1", "ven1"], esteira: "locacao" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(idsClassificados()).toEqual(["loc1"]);
    expect(body.ignored).toEqual(["ven1"]);
  });

  it("sem `esteira` no body, classifica tudo — retrocompatível", async () => {
    p.knowledgeItem.findMany.mockResolvedValue([
      clause("loc1", "locacao"),
      clause("ven1", "venda"),
    ]);

    const res = await POST(req({ clauseIds: ["loc1", "ven1"] }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(idsClassificados().sort()).toEqual(["loc1", "ven1"]);
    expect(body.ignored).toEqual([]);
  });

  // A tela mostra a cláusula sem esteira nas DUAS abas, no balde de triagem.
  // Descartá-la aqui tiraria do usuário a única ação que a tira de lá.
  it("NÃO descarta cláusula sem esteira nem `ambas`", async () => {
    p.knowledgeItem.findMany.mockResolvedValue([
      clause("semEsteira", null),
      clause("ambas1", "ambas"),
      clause("ven1", "venda"),
    ]);

    const res = await POST(req({ clauseIds: ["semEsteira", "ambas1", "ven1"], esteira: "locacao" }));
    const body = await res.json();

    expect(idsClassificados().sort()).toEqual(["ambas1", "semEsteira"]);
    expect(body.ignored).toEqual(["ven1"]);
  });

  // O 404 sempre significou "nada existe na org". Um lote inteiro fora da
  // esteira é outra coisa, e transformá-lo em erro mudaria mais comportamento
  // do que o bug corrige.
  it("lote inteiro fora da esteira continua 200, não vira 404", async () => {
    p.knowledgeItem.findMany.mockResolvedValue([clause("ven1", "venda")]);

    const res = await POST(req({ clauseIds: ["ven1"], esteira: "locacao" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(idsClassificados()).toEqual([]);
    expect(body.proposals).toEqual([]);
    expect(body.ignored).toEqual(["ven1"]);
  });

  it("404 continua reservado a `nada existe na org`", async () => {
    p.knowledgeItem.findMany.mockResolvedValue([]);

    const res = await POST(req({ clauseIds: ["fantasma"], esteira: "locacao" }));

    expect(res.status).toBe(404);
  });
});
