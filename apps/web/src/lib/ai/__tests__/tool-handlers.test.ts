import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeToolHandler } from "../tool-handlers";
import { prisma } from "@/lib/db/prisma";
import { renderContratoHTML } from "@/lib/render/handlebars";
import { createTestContext, createTestContractData } from "@/__tests__/helpers";
import type { AgentContext } from "../types";

const mockPrisma = vi.mocked(prisma);
const mockRender = vi.mocked(renderContratoHTML);

beforeEach(() => {
  vi.clearAllMocks();
  mockRender.mockImplementation(
    (_t: string, d: Record<string, unknown>) =>
      `<rendered>${JSON.stringify(d)}</rendered>`
  );
});

// ==========================================
// Routing
// ==========================================
describe("executeToolHandler routing", () => {
  it("routes query_clauses to correct handler", async () => {
    mockPrisma.clause.findMany.mockResolvedValue([]);
    const ctx = createTestContext();
    const result = await executeToolHandler("query_clauses", {}, ctx);
    expect(result).toHaveProperty("found");
    expect(mockPrisma.clause.findMany).toHaveBeenCalled();
  });

  it("routes validate_contract to correct handler", async () => {
    const ctx = createTestContext();
    const result = await executeToolHandler("validate_contract", {}, ctx);
    expect(result).toHaveProperty("totalIssues");
  });

  it("returns error for unknown tool", async () => {
    const ctx = createTestContext();
    const result = await executeToolHandler("unknown_tool", {}, ctx);
    expect(result.error).toBe("Tool desconhecida: unknown_tool");
  });
});

// ==========================================
// handleQueryClauses
// ==========================================
describe("handleQueryClauses", () => {
  it("queries with orgId and approved status", async () => {
    mockPrisma.clause.findMany.mockResolvedValue([]);
    const ctx = createTestContext();
    await executeToolHandler("query_clauses", {}, ctx);

    expect(mockPrisma.clause.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          orgId: "org-1",
          status: "approved",
        }),
      })
    );
  });

  it("filters by category when provided", async () => {
    mockPrisma.clause.findMany.mockResolvedValue([]);
    const ctx = createTestContext();
    await executeToolHandler(
      "query_clauses",
      { category: "penalidades" },
      ctx
    );

    expect(mockPrisma.clause.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ category: "penalidades" }),
      })
    );
  });

  it("filters by search with OR on title/content", async () => {
    mockPrisma.clause.findMany.mockResolvedValue([]);
    const ctx = createTestContext();
    await executeToolHandler(
      "query_clauses",
      { search: "multa" },
      ctx
    );

    expect(mockPrisma.clause.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              title: expect.objectContaining({ contains: "multa" }),
            }),
          ]),
        }),
      })
    );
  });

  it("returns found count and mapped clauses", async () => {
    mockPrisma.clause.findMany.mockResolvedValue([
      {
        id: "c1",
        category: "objeto",
        subcategory: null,
        title: "Cláusula Objeto",
        content: "Texto longo da clausula...",
        tags: ["objeto"],
        usageCount: 5,
      } as any,
    ]);

    const ctx = createTestContext();
    const result = await executeToolHandler("query_clauses", {}, ctx);
    expect(result.found).toBe(1);
    expect((result.clauses as any[])[0]).toMatchObject({
      id: "c1",
      category: "objeto",
      title: "Cláusula Objeto",
    });
  });

  it("truncates content to 500 chars", async () => {
    const longContent = "A".repeat(1000);
    mockPrisma.clause.findMany.mockResolvedValue([
      {
        id: "c1",
        category: "objeto",
        subcategory: null,
        title: "Test",
        content: longContent,
        tags: [],
        usageCount: 0,
      } as any,
    ]);

    const ctx = createTestContext();
    const result = await executeToolHandler("query_clauses", {}, ctx);
    expect(((result.clauses as any[])[0].content as string).length).toBe(500);
  });
});

// ==========================================
// handleQueryTemplates
// ==========================================
describe("handleQueryTemplates", () => {
  it("queries templates with orgId and active status", async () => {
    mockPrisma.contractTemplate.findMany.mockResolvedValue([]);
    const ctx = createTestContext();
    await executeToolHandler("query_templates", {}, ctx);

    expect(mockPrisma.contractTemplate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          orgId: "org-1",
          status: "active",
        }),
      })
    );
  });

  it("filters by schemaType when provided", async () => {
    mockPrisma.contractTemplate.findMany.mockResolvedValue([]);
    const ctx = createTestContext();
    await executeToolHandler(
      "query_templates",
      { schemaType: "compra_venda_v1" },
      ctx
    );

    expect(mockPrisma.contractTemplate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          schemaType: "compra_venda_v1",
        }),
      })
    );
  });
});

// ==========================================
// handleExplainClause
// ==========================================
describe("handleExplainClause", () => {
  it("returns clauseText and instruction without DB call", async () => {
    const ctx = createTestContext();
    const result = await executeToolHandler(
      "explain_clause",
      { clauseText: "O vendedor se obriga..." },
      ctx
    );
    expect(result.clauseText).toBe("O vendedor se obriga...");
    expect(result.instruction).toContain("Explique");
  });
});

// ==========================================
// handleEditSection
// ==========================================
describe("handleEditSection", () => {
  it("replaces target in HTML and returns success", async () => {
    const ctx = createTestContext({
      htmlContent: "<p>Valor: R$ 500.000,00</p>",
    });

    const result = await executeToolHandler(
      "edit_contract_section",
      {
        target: "R$ 500.000,00",
        replacement: "R$ 600.000,00",
      },
      ctx
    );

    expect(result.success).toBe(true);
    expect(ctx.htmlContent).toContain("R$ 600.000,00");
    expect(ctx.htmlContent).not.toContain("R$ 500.000,00");
  });

  it("returns error when target not found", async () => {
    const ctx = createTestContext({
      htmlContent: "<p>Contrato simples</p>",
    });

    const result = await executeToolHandler(
      "edit_contract_section",
      { target: "texto inexistente", replacement: "novo" },
      ctx
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("não encontrado");
  });

  it("returns preview truncated to 200 chars", async () => {
    const longReplacement = "B".repeat(300);
    const ctx = createTestContext({
      htmlContent: "<p>old</p>",
    });

    const result = await executeToolHandler(
      "edit_contract_section",
      { target: "old", replacement: longReplacement },
      ctx
    );

    expect(result.success).toBe(true);
    expect((result.preview as string).length).toBe(200);
  });
});

// ==========================================
// handleUpdateData
// ==========================================
describe("handleUpdateData", () => {
  it("applies patch via deep merge and re-renders", async () => {
    const ctx = createTestContext();

    const result = await executeToolHandler(
      "update_contract_data",
      { patch: { pagamento: { valor_total: 600000 } } },
      ctx
    );

    expect(result.success).toBe(true);
    expect((ctx.dataJson.pagamento as any).valor_total).toBe(600000);
    // Deep merge preserves existing keys
    expect((ctx.dataJson.pagamento as any).sinal_arras).toBe(50000);
    expect(mockRender).toHaveBeenCalled();
  });

  it("returns updatedFields list", async () => {
    const ctx = createTestContext();

    const result = await executeToolHandler(
      "update_contract_data",
      { patch: { pagamento: { valor_total: 600000 } } },
      ctx
    );

    expect(result.updatedFields).toEqual(["pagamento"]);
  });

  it("returns error for invalid patch", async () => {
    const ctx = createTestContext();

    const result = await executeToolHandler(
      "update_contract_data",
      { patch: null },
      ctx
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("inválido");
  });

  it("deep merges nested objects without losing siblings", async () => {
    const ctx = createTestContext({
      dataJson: {
        vendedores: [{ nome: "João" }],
        pagamento: { valor_total: 500000, sinal_arras: 50000 },
      },
    });

    await executeToolHandler(
      "update_contract_data",
      { patch: { pagamento: { sinal_arras: 80000 } } },
      ctx
    );

    expect((ctx.dataJson.pagamento as any).valor_total).toBe(500000);
    expect((ctx.dataJson.pagamento as any).sinal_arras).toBe(80000);
  });

  it("replaces arrays instead of merging", async () => {
    const ctx = createTestContext({
      dataJson: { vendedores: [{ nome: "João" }, { nome: "Pedro" }] },
    });

    await executeToolHandler(
      "update_contract_data",
      { patch: { vendedores: [{ nome: "Maria" }] } },
      ctx
    );

    expect(ctx.dataJson.vendedores).toEqual([{ nome: "Maria" }]);
  });
});

// ==========================================
// handleProposeSuggestion (BUG-003)
// ==========================================
describe("handleProposeSuggestion", () => {
  beforeEach(() => {
    mockPrisma.contractSuggestion.findFirst.mockResolvedValue(null);
    mockPrisma.contractSuggestion.create.mockImplementation(async (args: any) => ({
      id: "suggestion-row-1",
      ...args.data,
      createdAt: new Date(),
      resolvedAt: null,
      resolvedBy: null,
    }));
  });

  it("creates a ContractSuggestion row and injects <del><ins> markup", async () => {
    const ctx = createTestContext({
      htmlContent:
        "<p>Multa moratória de 2% (dois por cento) sobre o valor da obrigação inadimplida.</p>",
    });

    const result = await executeToolHandler(
      "propose_suggestion",
      {
        target: "Multa moratória de 2% (dois por cento)",
        replacement: "Multa moratória de 3% (três por cento)",
        reason: "Alinhar com política interna do escritório (regra A-42)",
      },
      ctx
    );

    expect(result.success).toBe(true);
    expect(mockPrisma.contractSuggestion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contractId: "contract-1",
          authorType: "ai",
          type: "replacement",
          status: "pending",
          originalText: "Multa moratória de 2% (dois por cento)",
          newText: "Multa moratória de 3% (três por cento)",
        }),
      })
    );
    expect(ctx.htmlContent).toContain("<del ");
    expect(ctx.htmlContent).toContain("<ins ");
    expect(ctx.htmlContent).toContain("data-suggestion-id=");
    expect(ctx.htmlContent).toContain("data-author=\"ai\"");
    // Markup wraps BOTH old and new text
    expect(ctx.htmlContent).toContain("Multa moratória de 2% (dois por cento)");
    expect(ctx.htmlContent).toContain("Multa moratória de 3% (três por cento)");
  });

  it("returns error when target text not found in contract", async () => {
    const ctx = createTestContext({
      htmlContent: "<p>Simple contract content.</p>",
    });

    const result = await executeToolHandler(
      "propose_suggestion",
      {
        target: "Nonexistent phrase in contract",
        replacement: "New text",
        reason: "Test",
      },
      ctx
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("não encontrado");
    expect(mockPrisma.contractSuggestion.create).not.toHaveBeenCalled();
  });

  it("dedupes: returns existing pending suggestion with same target", async () => {
    mockPrisma.contractSuggestion.findFirst.mockResolvedValue({
      id: "existing-suggestion-id",
      contractId: "contract-1",
      status: "pending",
      originalText: "Multa moratória de 2%",
    } as any);
    const ctx = createTestContext({
      htmlContent: "<p>Multa moratória de 2% ao dia.</p>",
    });

    const result = await executeToolHandler(
      "propose_suggestion",
      {
        target: "Multa moratória de 2%",
        replacement: "Multa moratória de 3%",
        reason: "duplicate test",
      },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.duplicate).toBe(true);
    expect(result.suggestionId).toBe("existing-suggestion-id");
    expect(mockPrisma.contractSuggestion.create).not.toHaveBeenCalled();
  });

  it("rejects when reason is missing", async () => {
    const ctx = createTestContext({ htmlContent: "<p>x</p>" });
    const result = await executeToolHandler(
      "propose_suggestion",
      { target: "x", replacement: "y" },
      ctx
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("reason");
  });

  it("supports type=deletion with empty replacement", async () => {
    const ctx = createTestContext({
      htmlContent: "<p>Cláusula X será removida aqui.</p>",
    });
    const result = await executeToolHandler(
      "propose_suggestion",
      {
        target: "Cláusula X será removida aqui.",
        replacement: "",
        reason: "Cláusula obsoleta",
        type: "deletion",
      },
      ctx
    );
    expect(result.success).toBe(true);
    expect(ctx.htmlContent).toContain("<del ");
    expect(ctx.htmlContent).not.toContain("<ins ");
  });
});

// ==========================================
// handleInsertClause
// ==========================================
describe("handleInsertClause", () => {
  it("returns error when clause not found", async () => {
    mockPrisma.clause.findUnique.mockResolvedValue(null);
    const ctx = createTestContext();

    const result = await executeToolHandler(
      "insert_clause",
      { clauseId: "nonexistent" },
      ctx
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("não encontrada");
  });

  it("returns error when clause already in contract", async () => {
    mockPrisma.clause.findUnique.mockResolvedValue({
      id: "clause-1",
      title: "Existing",
      category: "objeto",
      content: "<p>text</p>",
    } as any);

    const ctx = createTestContext(); // Has clause-1 in activeClauses

    const result = await executeToolHandler(
      "insert_clause",
      { clauseId: "clause-1" },
      ctx
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("já está no contrato");
  });

  it("inserts clause successfully", async () => {
    mockPrisma.clause.findUnique.mockResolvedValue({
      id: "clause-2",
      title: "Nova Cláusula",
      category: "penalidades",
      content: "<p>Penalidade</p>",
    } as any);
    mockPrisma.contractClause.create.mockResolvedValue({} as any);
    mockPrisma.clause.update.mockResolvedValue({} as any);

    const ctx = createTestContext();

    const result = await executeToolHandler(
      "insert_clause",
      { clauseId: "clause-2" },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.clauseTitle).toBe("Nova Cláusula");
    expect(mockPrisma.contractClause.create).toHaveBeenCalled();
    expect(mockPrisma.clause.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { usageCount: { increment: 1 } },
      })
    );
    // Clause should be added to activeClauses
    expect(ctx.activeClauses).toHaveLength(2);
    expect(ctx.activeClauses[1].clauseId).toBe("clause-2");
  });

  it("appends HTML at last </div>", async () => {
    mockPrisma.clause.findUnique.mockResolvedValue({
      id: "clause-new",
      title: "Test",
      category: "objeto",
      content: "<p>New</p>",
    } as any);
    mockPrisma.contractClause.create.mockResolvedValue({} as any);
    mockPrisma.clause.update.mockResolvedValue({} as any);

    const ctx = createTestContext({
      htmlContent: '<div class="contrato"><p>Content</p></div>',
      activeClauses: [],
    });

    await executeToolHandler("insert_clause", { clauseId: "clause-new" }, ctx);

    expect(ctx.htmlContent).toContain('class="clausula-inserida"');
    expect(ctx.htmlContent).toContain("</div>");
  });
});

// ==========================================
// handleRemoveClause
// ==========================================
describe("handleRemoveClause", () => {
  it("returns error when clause not linked to contract", async () => {
    mockPrisma.contractClause.findFirst.mockResolvedValue(null);
    const ctx = createTestContext();

    const result = await executeToolHandler(
      "remove_clause",
      { clauseId: "nonexistent" },
      ctx
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("não está vinculada");
  });

  it("removes clause successfully", async () => {
    mockPrisma.contractClause.findFirst.mockResolvedValue({
      id: "cc-1",
      clauseId: "clause-1",
      clause: { title: "Cláusula Removida" },
    } as any);
    mockPrisma.contractClause.delete.mockResolvedValue({} as any);

    const ctx = createTestContext();

    const result = await executeToolHandler(
      "remove_clause",
      { clauseId: "clause-1" },
      ctx
    );

    expect(result.success).toBe(true);
    expect(mockPrisma.contractClause.delete).toHaveBeenCalledWith({
      where: { id: "cc-1" },
    });
    expect(ctx.activeClauses.find((c) => c.clauseId === "clause-1")).toBeUndefined();
  });
});

// ==========================================
// handleValidateContract
// ==========================================
describe("handleValidateContract", () => {
  it("returns grouped issues from validateContractData", async () => {
    const ctx = createTestContext();
    const result = await executeToolHandler("validate_contract", {}, ctx);

    expect(result).toHaveProperty("totalIssues");
    expect(result).toHaveProperty("errors");
    expect(result).toHaveProperty("warnings");
    expect(result).toHaveProperty("info");
    expect(typeof result.totalIssues).toBe("number");
  });

  it("detects empty patterns in HTML", async () => {
    const ctx = createTestContext({
      htmlContent: "<p>Valor: R$ 0,00 no dia //</p>",
    });
    const result = await executeToolHandler("validate_contract", {}, ctx);

    const warnings = result.warnings as any[];
    const htmlWarnings = warnings.filter((w: any) => w.field === "htmlContent");
    expect(htmlWarnings.length).toBeGreaterThan(0);
  });

  it("detects missing accents in HTML", async () => {
    const ctx = createTestContext({
      htmlContent: "<p>O preco do imovel conforme clausula</p>",
    });
    const result = await executeToolHandler("validate_contract", {}, ctx);

    const warnings = result.warnings as any[];
    const accentWarnings = warnings.filter(
      (w: any) => w.field === "ortografia"
    );
    expect(accentWarnings.length).toBeGreaterThanOrEqual(3); // preco, imovel, clausula
  });
});

// ==========================================
// handleSuggestImprovements
// ==========================================
describe("handleSuggestImprovements", () => {
  beforeEach(() => {
    // Mock clause.findMany for linked clause check in suggest_improvements
    (prisma.clause.findMany as any).mockResolvedValue([]);
  });

  it("suggests suspensive condition for financing", async () => {
    const ctx = createTestContext();
    const result = await executeToolHandler(
      "suggest_improvements",
      {},
      ctx
    );

    const suggestions = result.suggestions as any[];
    const financing = suggestions.find(
      (s: any) => s.importance === "critical" && s.title.includes("G4")
    );
    expect(financing).toBeDefined();
  });

  it("suggests tenant preference for occupied property", async () => {
    const ctx = createTestContext({
      dataJson: createTestContractData({ ocupacao: "ocupado-terceiro" }),
    });

    const result = await executeToolHandler(
      "suggest_improvements",
      {},
      ctx
    );

    const suggestions = result.suggestions as any[];
    const tenant = suggestions.find((s: any) =>
      s.title.includes("Locatário")
    );
    expect(tenant).toBeDefined();
  });

  it("suggests clearance clause for outstanding debt", async () => {
    const ctx = createTestContext({
      dataJson: createTestContractData({ saldo_devedor: 100000 }),
    });

    const result = await executeToolHandler(
      "suggest_improvements",
      {},
      ctx
    );

    const suggestions = result.suggestions as any[];
    const clearance = suggestions.find((s: any) =>
      s.title.includes("Quitação")
    );
    expect(clearance).toBeDefined();
  });

  it("suggests repair deadline for declared defects", async () => {
    const ctx = createTestContext({
      dataJson: createTestContractData({
        vicios: { descricao_reparar: "Infiltração no teto" },
      }),
    });

    const result = await executeToolHandler(
      "suggest_improvements",
      {},
      ctx
    );

    const suggestions = result.suggestions as any[];
    const repair = suggestions.find((s: any) =>
      s.title.includes("Reparo")
    );
    expect(repair).toBeDefined();
  });

  it("suggests commission exemption when no commission", async () => {
    const ctx = createTestContext({
      dataJson: createTestContractData({ comissao: { valor: 0 } }),
    });

    const result = await executeToolHandler(
      "suggest_improvements",
      {},
      ctx
    );

    const suggestions = result.suggestions as any[];
    const commission = suggestions.find((s: any) =>
      s.title.includes("Comissão")
    );
    expect(commission).toBeDefined();
  });

  it("returns empty suggestions when no conditions match", async () => {
    const ctx = createTestContext({
      dataJson: {
        pagamento: { alienacao_fiduciaria: 0 },
        ocupacao: "desocupado",
        saldo_devedor: 0,
        comissao: { valor: 25000 },
      },
    });

    const result = await executeToolHandler(
      "suggest_improvements",
      {},
      ctx
    );

    expect(result.totalSuggestions).toBe(0);
    expect((result.suggestions as any[]).length).toBe(0);
  });
});

// ==========================================
// handleExtractDocument
// ==========================================
describe("handleExtractDocument", () => {
  it("returns success when FormAttachment found", async () => {
    mockPrisma.formAttachment.findUnique.mockResolvedValue({
      id: "att-1",
      url: "https://example.com/doc.pdf",
      category: "rg",
      mime: "image/jpeg",
    } as any);

    const ctx = createTestContext();
    const result = await executeToolHandler(
      "extract_document_data",
      { attachmentId: "att-1" },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.category).toBe("rg");
  });

  it("falls back to DealAttachment", async () => {
    mockPrisma.formAttachment.findUnique.mockResolvedValue(null);
    mockPrisma.dealAttachment.findUnique.mockResolvedValue({
      id: "att-2",
      url: "https://example.com/doc.pdf",
      category: "matricula",
      mime: "application/pdf",
    } as any);

    const ctx = createTestContext();
    const result = await executeToolHandler(
      "extract_document_data",
      { attachmentId: "att-2" },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.category).toBe("matricula");
  });

  it("returns error when no attachment found", async () => {
    mockPrisma.formAttachment.findUnique.mockResolvedValue(null);
    mockPrisma.dealAttachment.findUnique.mockResolvedValue(null);

    const ctx = createTestContext();
    const result = await executeToolHandler(
      "extract_document_data",
      { attachmentId: "nonexistent" },
      ctx
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("não encontrado");
  });
});
