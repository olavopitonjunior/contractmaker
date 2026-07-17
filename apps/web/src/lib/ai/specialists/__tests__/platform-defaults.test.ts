import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  getPlatformAgentDefaults,
  getTenantAgentInstructions,
  buildTenantInstructionsBlock,
  __resetPlatformDefaultsCacheForTests,
  __resetTenantInstructionsCacheForTests,
} from "../platform-defaults";
import { DEFAULT_SYSTEM_PROMPT } from "../../prompts";

const padFind = prisma.platformAgentDefaults.findFirst as unknown as ReturnType<typeof vi.fn>;
const acFind = prisma.agentConfig.findUnique as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  __resetPlatformDefaultsCacheForTests();
  __resetTenantInstructionsCacheForTests();
});

describe("getPlatformAgentDefaults", () => {
  it("sem row → tudo null (fallback hardcoded)", async () => {
    padFind.mockResolvedValue(null);
    const d = await getPlatformAgentDefaults();
    expect(d.analystPrompt).toBeNull();
    expect(d.editorModel).toBeNull();
  });

  it("normaliza vazio/whitespace pra null; cacheia (1 hit de DB)", async () => {
    padFind.mockResolvedValue({
      analystPrompt: "  prompt custom  ",
      legalPrompt: "   ",
      editorPrompt: null,
      curatorPrompt: "",
      analystModel: "claude-sonnet-4-6",
      legalModel: null,
      editorModel: " ",
      curatorModel: null,
    });
    const d = await getPlatformAgentDefaults();
    expect(d.analystPrompt).toBe("prompt custom");
    expect(d.legalPrompt).toBeNull();
    expect(d.curatorPrompt).toBeNull();
    expect(d.analystModel).toBe("claude-sonnet-4-6");
    expect(d.editorModel).toBeNull();

    await getPlatformAgentDefaults();
    expect(padFind).toHaveBeenCalledTimes(1); // cache 60s
  });

  it("falha de DB → fallback vazio sem lançar", async () => {
    padFind.mockRejectedValue(new Error("db down"));
    const d = await getPlatformAgentDefaults();
    expect(d.analystPrompt).toBeNull();
  });
});

describe("getTenantAgentInstructions", () => {
  it("prompt custom do tenant → retorna trimado", async () => {
    acFind.mockResolvedValue({ systemPrompt: "  Sempre usar foro de Curitiba.  " });
    expect(await getTenantAgentInstructions("org1")).toBe(
      "Sempre usar foro de Curitiba."
    );
  });

  it("campo igual ao DEFAULT_SYSTEM_PROMPT legado → null (não é instrução adicional)", async () => {
    acFind.mockResolvedValue({ systemPrompt: DEFAULT_SYSTEM_PROMPT });
    expect(await getTenantAgentInstructions("org1")).toBeNull();
  });

  it("sem row / vazio → null; cache por org", async () => {
    acFind.mockResolvedValue(null);
    expect(await getTenantAgentInstructions("org1")).toBeNull();
    await getTenantAgentInstructions("org1");
    expect(acFind).toHaveBeenCalledTimes(1);
  });
});

describe("buildTenantInstructionsBlock", () => {
  it("cerca delimitada com regra de precedência da plataforma", () => {
    const block = buildTenantInstructionsBlock("minha instrução");
    expect(block).toContain("<instrucoes_da_imobiliaria>");
    expect(block).toContain("minha instrução");
    expect(block).toContain("</instrucoes_da_imobiliaria>");
    expect(block).toContain("regras da plataforma vencem");
  });
});
