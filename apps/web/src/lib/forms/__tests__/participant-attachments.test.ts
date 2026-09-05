import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { claimParticipantAttachments } from "../participant-attachments";

const updateMany = prisma.formAttachment.updateMany as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  updateMany.mockResolvedValue({ count: 1 });
});

describe("claimParticipantAttachments — o link da parte herda os documentos dela", () => {
  it("casa por papel E índice, e só toca anexo ainda sem dono", async () => {
    const n = await claimParticipantAttachments("form1", [
      { id: "part-loc", role: "locatario", partyIndex: 0 },
    ]);
    expect(n).toBe(1);
    const w = updateMany.mock.calls[0][0].where;
    expect(w.formId).toBe("form1");
    // sem isto, o claim roubaria anexo já atribuído a outro participante
    expect(w.participantId).toBeNull();
    expect(w.AND).toEqual([
      { extractedData: { path: ["assignment", "kind"], equals: "locatario" } },
      { extractedData: { path: ["assignment", "index"], equals: 0 } },
    ]);
    expect(updateMany.mock.calls[0][0].data).toEqual({ participantId: "part-loc" });
  });

  it("um update por participante, cada um com o próprio papel/índice", async () => {
    updateMany.mockResolvedValueOnce({ count: 2 }).mockResolvedValueOnce({ count: 0 });
    const n = await claimParticipantAttachments("form1", [
      { id: "p-a", role: "locador", partyIndex: 0 },
      { id: "p-b", role: "locatario", partyIndex: 1 },
    ]);
    expect(n).toBe(2);
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(updateMany.mock.calls[1][0].where.AND[1]).toEqual({
      extractedData: { path: ["assignment", "index"], equals: 1 },
    });
    expect(updateMany.mock.calls[1][0].data).toEqual({ participantId: "p-b" });
  });

  it("papel sem correspondência de assignment (terceiro, fiador) simplesmente não reivindica nada", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    expect(await claimParticipantAttachments("form1", [{ id: "p", role: "terceiro:contador", partyIndex: 0 }])).toBe(0);
  });

  it("sem participantes → nenhuma escrita", async () => {
    expect(await claimParticipantAttachments("form1", [])).toBe(0);
    expect(updateMany).not.toHaveBeenCalled();
  });
});
