import { describe, it, expect, vi, beforeEach } from "vitest";
import { releaseClaim } from "../send-execute";
import { prisma } from "@/lib/db/prisma";

const mockPrisma = vi.mocked(prisma);

/**
 * INVARIANTE: `releaseClaim` NUNCA rejeita.
 *
 * Ele roda dentro de `catch (err) { await releaseClaim(...); throw err; }`
 * (executeProposalSend) — se lançasse, MASCARARIA o erro original do envio,
 * que é exatamente a informação que o corretor e o log precisam.
 *
 * Hoje a garantia é composição de dois `.catch()` distantes: um no updateMany
 * daqui e outro dentro de `logProposalEvent`, mil linhas abaixo. Um refactor
 * que troque `logProposalEvent` por um `prisma.proposalEvent.create` direto
 * quebra o invariante sem nenhum erro de compilação — este teste é o que
 * transforma a propriedade implícita em contrato.
 */
describe("releaseClaim nunca rejeita", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updateMany falha → resolve, não propaga (e não grava evento)", async () => {
    mockPrisma.proposal.updateMany.mockRejectedValue(new Error("connection reset"));
    await expect(releaseClaim("p1")).resolves.toBeUndefined();
    expect(mockPrisma.proposalEvent.create).not.toHaveBeenCalled();
  });

  it("CAS moveu mas a escrita do send_failed falha → resolve mesmo assim", async () => {
    mockPrisma.proposal.updateMany.mockResolvedValue({ count: 1 } as never);
    mockPrisma.proposalEvent.create.mockRejectedValue(new Error("P2002 ou timeout"));
    await expect(releaseClaim("p1")).resolves.toBeUndefined();
  });

  it("CAS moveu e tudo ok → grava send_failed (o rastro é o ponto do fix)", async () => {
    mockPrisma.proposal.updateMany.mockResolvedValue({ count: 1 } as never);
    mockPrisma.proposalEvent.create.mockResolvedValue({} as never);
    await releaseClaim("p1");
    expect(mockPrisma.proposalEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventName: "send_failed" }),
      })
    );
  });

  it("CAS não moveu (count 0) → NÃO grava send_failed", async () => {
    // Sem isto, chamar releaseClaim numa proposta que já saiu de `enviada`
    // (webhook ganhou a corrida) registraria uma falha que não houve.
    mockPrisma.proposal.updateMany.mockResolvedValue({ count: 0 } as never);
    await releaseClaim("p1");
    expect(mockPrisma.proposalEvent.create).not.toHaveBeenCalled();
  });
});
