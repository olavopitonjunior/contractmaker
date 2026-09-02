/**
 * `PATCH /api/clauses/[id]` é a única rota pública que escreve `tags` de uma
 * cláusula. Ela precisa recusar alteração nas origens CURADAS.
 *
 * Por quê: a identidade de `seed_curado` e `consolidacao_modelos` é o CONJUNTO
 * EXATO de tags (`ingest-clauses.ts::sameTagSet`). Mudar esse conjunto — até
 * ACRESCENTANDO — faz a próxima reingestão criar uma duplicata em vez de
 * arquivar a anterior, e aí `rankSlotCandidates` passa a ter dois `approved`
 * empatados no mesmo slot. Falha silenciosa, meses depois.
 *
 * O editor já esconde o campo nesse caso, mas isso é proteção de CLIENT: um
 * curl, uma integração ou um bug futuro de UI passariam direto. Achado de
 * review.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { PATCH } from "../[id]/route";

vi.mock("@/lib/ai/knowledge", () => ({
  updateKnowledgeItem: vi.fn().mockResolvedValue(undefined),
}));

import { updateKnowledgeItem } from "@/lib/ai/knowledge";

const mockPrisma = prisma as unknown as {
  knowledgeItem: { findFirst: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> };
};

function req(body: unknown) {
  return new NextRequest("http://localhost/api/clauses/cl1", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function clause(over: Record<string, unknown> = {}) {
  return {
    id: "cl1",
    orgId: "org-1",
    category: "clause",
    title: "Garantia — Caução",
    content: "texto",
    tags: ["slot:garantia", "garantia:caucao"],
    source: "seed_curado",
    subcategory: "garantia",
    groupCode: null,
    esteira: "locacao",
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
  mockPrisma.knowledgeItem.findUnique.mockResolvedValue(clause());
});

describe("PATCH /api/clauses/[id] — tags congeladas", () => {
  it("recusa alteração de tags em cláusula seed_curado", async () => {
    mockPrisma.knowledgeItem.findFirst.mockResolvedValue(clause());

    const res = await PATCH(req({ tags: ["slot:garantia", "garantia:caucao", "tema:garantia"] }), {
      params: { id: "cl1" },
    });

    expect(res.status).toBe(409);
    expect(updateKnowledgeItem).not.toHaveBeenCalled();
  });

  it("recusa também quando a origem se perdeu mas há tag de identidade", async () => {
    mockPrisma.knowledgeItem.findFirst.mockResolvedValue(
      clause({ source: "manual", tags: ["provider:porto_seguro"] })
    );

    const res = await PATCH(req({ tags: ["provider:porto_seguro", "tema:garantia"] }), {
      params: { id: "cl1" },
    });

    expect(res.status).toBe(409);
  });

  it("deixa passar quando o PATCH não toca em tags", async () => {
    mockPrisma.knowledgeItem.findFirst.mockResolvedValue(clause());

    const res = await PATCH(req({ title: "Novo título" }), { params: { id: "cl1" } });

    expect(res.status).toBe(200);
    expect(updateKnowledgeItem).toHaveBeenCalled();
  });

  it("permite editar tags de cláusula manual comum", async () => {
    mockPrisma.knowledgeItem.findFirst.mockResolvedValue(
      clause({ source: "manual", tags: ["locacao"] })
    );

    const res = await PATCH(req({ tags: ["locacao", "tema:vistoria"] }), {
      params: { id: "cl1" },
    });

    expect(res.status).toBe(200);
    expect(updateKnowledgeItem).toHaveBeenCalledWith(
      "cl1",
      "org-1",
      expect.objectContaining({ tags: ["locacao", "tema:vistoria"] })
    );
  });
});
