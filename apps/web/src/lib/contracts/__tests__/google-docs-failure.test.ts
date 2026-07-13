import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    contract: {
      delete: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import {
  GoogleDocsGenerationError,
  googleDocsFailureMessage,
  rollbackFailedContract,
} from "../google-docs-failure";
import { prisma } from "@/lib/db/prisma";

const mockDelete = vi.mocked(prisma.contract.delete);
const mockFindFirst = vi.mocked(prisma.contract.findFirst);
const mockUpdate = vi.mocked(prisma.contract.update);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("googleDocsFailureMessage", () => {
  // O modo de falha real: a org trocou a conta Google conectada e o escopo
  // `drive.file` (per-file, por usuário) não enxerga o Doc criado pela conta antiga.
  it("explica o reenvio do modelo quando o Drive responde 404", () => {
    const msg = googleDocsFailureMessage(
      new Error("Request failed with status code 404: File not found: 1abc"),
      "RE/MAX Trio — Locação Residencial"
    );
    expect(msg).toContain("RE/MAX Trio — Locação Residencial");
    expect(msg).toContain("outra conta Google");
    expect(msg).toContain("Importar modelo");
  });

  it("explica o reenvio também no 403 (permissão)", () => {
    const msg = googleDocsFailureMessage(
      new Error("The caller does not have permission"),
      "Modelo X"
    );
    expect(msg).toContain("outra conta Google");
  });

  it("não inventa a causa de conta quando o erro é outro", () => {
    const msg = googleDocsFailureMessage(new Error("socket hang up"), "Modelo X");
    expect(msg).not.toContain("outra conta Google");
    expect(msg).toContain("socket hang up");
  });
});

describe("rollbackFailedContract", () => {
  it("apaga o contrato órfão e devolve o isLatest à versão anterior", async () => {
    mockFindFirst.mockResolvedValue({ id: "prev-1" } as never);

    await rollbackFailedContract("new-1", "deal-1", "contract");

    expect(mockDelete).toHaveBeenCalledWith({ where: { id: "new-1" } });
    // Sem isto o deal ficaria sem NENHUMA versão marcada como atual — as telas
    // leem o contrato por isLatest.
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "prev-1" },
      data: { isLatest: true },
    });
  });

  it("não promove nada quando era a primeira versão do deal", async () => {
    mockFindFirst.mockResolvedValue(null as never);

    await rollbackFailedContract("new-1", "deal-1", "contract");

    expect(mockDelete).toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("engole falha do próprio rollback (o erro original é que importa)", async () => {
    mockDelete.mockRejectedValue(new Error("FK violation") as never);
    await expect(rollbackFailedContract("new-1", "deal-1", "contract")).resolves.toBeUndefined();
  });
});

describe("GoogleDocsGenerationError", () => {
  it("preserva a causa original pra diagnóstico", () => {
    const cause = new Error("404");
    const err = new GoogleDocsGenerationError("mensagem PT-BR", cause);
    expect(err.name).toBe("GoogleDocsGenerationError");
    expect(err.cause).toBe(cause);
  });
});
