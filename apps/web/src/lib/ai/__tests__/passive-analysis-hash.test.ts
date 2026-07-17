import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { runPassiveAnalysis } from "../agent";
import { prisma } from "@/lib/db/prisma";
import { Anthropic } from "@anthropic-ai/sdk";
import { createAnthropicTextResponse } from "@/__tests__/helpers";

const mockPrisma = vi.mocked(prisma);

const HTML = "<p>Contrato de compra e venda — texto estável</p>";
const HTML_HASH = createHash("sha1").update(HTML).digest("hex");

let mockCreate: ReturnType<typeof vi.fn>;

function mockContract(overrides: Record<string, unknown> = {}) {
  mockPrisma.contract.findUniqueOrThrow.mockResolvedValue({
    id: "contract-1",
    status: "rascunho",
    dealId: "deal-1",
    htmlContent: HTML,
    googleDocId: null, // sem GDoc → usa htmlContent direto (sem Drive no test)
    dataJson: { vendedores: [] },
    template: null,
    deal: { kind: "venda" },
    lastAnalyzedTextHash: null,
    ...overrides,
  } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  const instance = new Anthropic();
  mockCreate = vi.mocked(instance.messages.create);

  mockContract();
  mockPrisma.contractComment.findMany.mockResolvedValue([]);
  mockPrisma.contractComment.upsert = vi.fn().mockResolvedValue({});
  mockPrisma.contractChangeLog.create.mockResolvedValue({} as any);
  mockPrisma.contract.update.mockResolvedValue({} as any);
  mockCreate.mockResolvedValue(
    createAnthropicTextResponse('{"findings": []}')
  );
});

describe("runPassiveAnalysis — skip por hash do texto", () => {
  it("hash igual → skipa (open E edit) sem chamar o LLM", async () => {
    mockContract({ lastAnalyzedTextHash: HTML_HASH });

    for (const trigger of ["open", "edit"] as const) {
      const result = await runPassiveAnalysis({
        contractId: "contract-1",
        orgId: "org-1",
        trigger,
      });
      expect(result.modelUsed).toBe("skipped-no-change");
      expect(result.findings).toHaveLength(0);
    }
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("hash diferente (texto mudou) → analisa e atualiza o hash", async () => {
    mockContract({ lastAnalyzedTextHash: "hash-antigo-diferente" });

    const result = await runPassiveAnalysis({
      contractId: "contract-1",
      orgId: "org-1",
      trigger: "edit",
    });

    expect(result.modelUsed).not.toBe("skipped-no-change");
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockPrisma.contract.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "contract-1" },
        data: { lastAnalyzedTextHash: HTML_HASH },
      })
    );
  });

  it("hash null (nunca analisado) → analisa", async () => {
    const result = await runPassiveAnalysis({
      contractId: "contract-1",
      orgId: "org-1",
      trigger: "open",
    });
    expect(result.modelUsed).not.toBe("skipped-no-change");
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("falha do LLM → NÃO atualiza o hash (próxima tentativa re-analisa)", async () => {
    mockCreate.mockRejectedValueOnce(new Error("api down"));

    await runPassiveAnalysis({
      contractId: "contract-1",
      orgId: "org-1",
      trigger: "open",
    });

    expect(mockPrisma.contract.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: { lastAnalyzedTextHash: HTML_HASH },
      })
    );
  });

  it("trigger approve → não skipa por hash nem atualiza hash (quickChecks sempre rodam)", async () => {
    mockContract({ lastAnalyzedTextHash: HTML_HASH });

    const result = await runPassiveAnalysis({
      contractId: "contract-1",
      orgId: "org-1",
      trigger: "approve",
    });

    // approve não roda LLM (rota /approve valida), mas não pode virar skip
    expect(result.modelUsed).toBe("quickChecks-only");
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockPrisma.contract.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: { lastAnalyzedTextHash: expect.anything() },
      })
    );
  });
});
