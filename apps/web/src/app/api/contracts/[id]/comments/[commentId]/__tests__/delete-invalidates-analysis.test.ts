import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { DELETE } from "../route";

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;
const mockGetUserOrg = getUserOrg as unknown as ReturnType<typeof vi.fn>;
const contractUpdate = prisma.contract.update as unknown as ReturnType<typeof vi.fn>;
// findUnique/delete não estão no mock global do prisma — criados por teste.
let findUnique: ReturnType<typeof vi.fn>;
let del: ReturnType<typeof vi.fn>;

function scopedComment(over: Record<string, unknown> = {}) {
  return {
    id: "cm-1",
    authorType: "ai",
    googleCommentId: null,
    contract: {
      id: "contract-1",
      googleDocId: null,
      deal: { pipeline: { orgId: "org-1" } },
    },
    ...over,
  };
}

const req = {} as never;
const params = { params: { id: "contract-1", commentId: "cm-1" } };

describe("DELETE comment — invalida o hash de análise passiva", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "u-1" } });
    mockGetUserOrg.mockResolvedValue({ id: "org-1" });
    findUnique = vi.fn();
    del = vi.fn().mockResolvedValue({});
    (prisma.contractComment as unknown as Record<string, unknown>).findUnique = findUnique;
    (prisma.contractComment as unknown as Record<string, unknown>).delete = del;
    contractUpdate.mockResolvedValue({});
  });

  it("deletar comentário de IA zera lastAnalyzedTextHash (re-passe no próximo open)", async () => {
    findUnique.mockResolvedValue(scopedComment({ authorType: "ai" }));
    const res = await DELETE(req, params);
    expect(res.status).toBe(200);
    expect(contractUpdate).toHaveBeenCalledWith({
      where: { id: "contract-1" },
      data: { lastAnalyzedTextHash: null },
    });
  });

  it("deletar comentário de HUMANO não toca no carimbo", async () => {
    findUnique.mockResolvedValue(scopedComment({ authorType: "user" }));
    const res = await DELETE(req, params);
    expect(res.status).toBe(200);
    expect(contractUpdate).not.toHaveBeenCalled();
  });

  it("comentário cross-org → 404 e não deleta nem invalida", async () => {
    findUnique.mockResolvedValue(
      scopedComment({ contract: { id: "contract-1", googleDocId: null, deal: { pipeline: { orgId: "outra-org" } } } })
    );
    const res = await DELETE(req, params);
    expect(res.status).toBe(404);
    expect(del).not.toHaveBeenCalled();
    expect(contractUpdate).not.toHaveBeenCalled();
  });
});
