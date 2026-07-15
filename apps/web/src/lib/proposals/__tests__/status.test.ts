import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { advanceProposalStatus, ALLOWED_FROM, isTerminal } from "../status";

const updateMany = prisma.proposal.updateMany as unknown as ReturnType<typeof vi.fn>;
const findUnique = prisma.proposal.findUnique as unknown as ReturnType<typeof vi.fn>;
const eventCreate = prisma.proposalEvent.create as unknown as ReturnType<typeof vi.fn>;

describe("ALLOWED_FROM — cobre os predecessores certos", () => {
  it("recusada_vendedor aceita aguardando_vendedor (o bug do plano v1)", () => {
    expect(ALLOWED_FROM.recusada_vendedor).toContain("aguardando_vendedor");
    expect(ALLOWED_FROM.recusada_vendedor).toContain("assinada_proponente");
  });

  it("assinada_proponente aceita `enviada` direto (assinou sem abrir a landing)", () => {
    expect(ALLOWED_FROM.assinada_proponente).toContain("enviada");
  });

  it("isTerminal reconhece os terminais", () => {
    expect(isTerminal("convertida")).toBe(true);
    expect(isTerminal("recusada_vendedor")).toBe(true);
    expect(isTerminal("enviada")).toBe(false);
  });
});

describe("advanceProposalStatus — CAS idempotente", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eventCreate.mockResolvedValue({});
  });

  it("transição válida → moved:true", async () => {
    updateMany.mockResolvedValue({ count: 1 });
    const r = await advanceProposalStatus("p1", "visualizada");
    expect(r.moved).toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "p1", status: { in: ["enviada", "entregue"] } },
      data: { status: "visualizada" },
    });
  });

  it("replay (já no destino) → moved:false, reason replay, SEM evento de rejeição", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    findUnique.mockResolvedValue({ status: "visualizada" });
    const r = await advanceProposalStatus("p1", "visualizada");
    expect(r).toEqual({ moved: false, reason: "replay" });
    expect(eventCreate).not.toHaveBeenCalled();
  });

  it("transição ILEGAL → reason illegal + registra ProposalEvent (não engole)", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    findUnique.mockResolvedValue({ status: "cancelada" });
    const r = await advanceProposalStatus("p1", "assinada_proponente");
    expect(r).toEqual({ moved: false, reason: "illegal", from: "cancelada" });
    expect(eventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventName: "status_transition_rejected" }),
      })
    );
  });
});
