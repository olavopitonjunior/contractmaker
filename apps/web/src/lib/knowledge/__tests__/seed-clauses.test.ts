import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";

vi.mock("@/lib/ai/knowledge", () => ({
  createKnowledgeItemRows: vi.fn().mockResolvedValue({ embedTargets: [] }),
  embedKnowledgeItem: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/modules/read", () => ({
  getOrgModules: vi.fn(),
  isModuleEnabled: vi.fn(),
}));

import { seedDefaultClauses } from "../seed-clauses";
import { createKnowledgeItemRows } from "@/lib/ai/knowledge";
import { getOrgModules, isModuleEnabled } from "@/lib/modules/read";
import { VENDAS_SEED_CLAUSES } from "../seed-clauses-vendas";
import { LOCACAO_SEED_CLAUSES } from "../seed-clauses-locacao";

const kbFind = prisma.knowledgeItem.findMany as unknown as ReturnType<typeof vi.fn>;
const create = createKnowledgeItemRows as unknown as ReturnType<typeof vi.fn>;
const modEnabled = isModuleEnabled as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  kbFind.mockResolvedValue([]);
  create.mockResolvedValue({ embedTargets: [] });
  (getOrgModules as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});
});

describe("seedDefaultClauses", () => {
  it("banks explícito 'vendas' → só G1..G6 com groupCode", async () => {
    const res = await seedDefaultClauses({ orgId: "o1", createdBy: "u1", banks: ["vendas"] });
    expect(res.created).toBe(VENDAS_SEED_CLAUSES.length);
    // toda criação de venda leva groupCode não-nulo
    for (const call of create.mock.calls) {
      expect(call[0].groupCode).toMatch(/^G[1-6]$/);
      expect(call[0].category).toBe("clause");
    }
  });

  it("banks 'locacao' → groupCode null + tag locacao", async () => {
    const res = await seedDefaultClauses({ orgId: "o1", createdBy: "u1", banks: ["locacao"] });
    expect(res.created).toBe(LOCACAO_SEED_CLAUSES.length);
    for (const call of create.mock.calls) {
      expect(call[0].groupCode).toBeNull();
      expect(call[0].tags).toContain("locacao");
    }
  });

  it("decide pelos módulos quando banks ausente (vendas+locação)", async () => {
    modEnabled.mockReturnValue(true); // ambos habilitados
    const res = await seedDefaultClauses({ orgId: "o1", createdBy: "u1" });
    expect(res.created).toBe(VENDAS_SEED_CLAUSES.length + LOCACAO_SEED_CLAUSES.length);
  });

  it("idempotente: títulos existentes são pulados", async () => {
    const firstTitle = VENDAS_SEED_CLAUSES[0].title;
    kbFind.mockResolvedValue([{ title: firstTitle }]);
    const res = await seedDefaultClauses({ orgId: "o1", createdBy: "u1", banks: ["vendas"] });
    expect(res.created).toBe(VENDAS_SEED_CLAUSES.length - 1);
    expect(res.skipped).toBe(1);
    expect(create.mock.calls.some((c) => c[0].title === firstTitle)).toBe(false);
  });

  it("org sem nenhum módulo → fallback vendas", async () => {
    modEnabled.mockReturnValue(false);
    const res = await seedDefaultClauses({ orgId: "o1", createdBy: "u1" });
    expect(res.created).toBe(VENDAS_SEED_CLAUSES.length);
  });
});
