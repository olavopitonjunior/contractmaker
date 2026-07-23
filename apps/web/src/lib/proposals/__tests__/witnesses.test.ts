import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { ensureProposalDefaultWitnesses } from "../witnesses";

const propFind = prisma.proposal.findUnique as unknown as ReturnType<typeof vi.fn>;
const witFind = prisma.defaultWitness.findMany as unknown as ReturnType<typeof vi.fn>;
const signerCreate = prisma.proposalSigner.createMany as unknown as ReturnType<
  typeof vi.fn
>;

describe("ensureProposalDefaultWitnesses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    propFind.mockResolvedValue({ orgId: "org1" });
    signerCreate.mockResolvedValue({ count: 0 });
  });

  it("no-op quando a org não tem testemunhas padrão de proposta", async () => {
    witFind.mockResolvedValue([]);
    const n = await ensureProposalDefaultWitnesses("p1");
    expect(n).toBe(0);
    expect(signerCreate).not.toHaveBeenCalled();
  });

  it("filtra o cadastro por scope=proposta e isDefault", async () => {
    witFind.mockResolvedValue([]);
    await ensureProposalDefaultWitnesses("p1");
    expect(witFind).toHaveBeenCalledWith({
      where: { orgId: "org1", isDefault: true, scope: "proposta" },
    });
  });

  it("materializa testemunhas como ProposalSigner role=testemunha grupo 2", async () => {
    witFind.mockResolvedValue([
      { nome: "Ana Lima", email: "ana@x.com", cpf: "111.222.333-44", mobilePhone: "11987654321" },
    ]);
    signerCreate.mockResolvedValue({ count: 1 });
    const n = await ensureProposalDefaultWitnesses("p1");
    expect(n).toBe(1);
    const arg = signerCreate.mock.calls[0][0];
    expect(arg.skipDuplicates).toBe(true);
    expect(arg.data[0]).toMatchObject({
      proposalId: "p1",
      role: "testemunha",
      name: "Ana Lima",
      email: "ana@x.com",
      cpf: "11122233344",
      phone: "+5511987654321",
      signingGroup: 2,
      notifyChannel: "email",
    });
    expect(typeof arg.data[0].dedupeKey).toBe("string");
  });

  it("ignora testemunha padrão sem e-mail (não dá pra notificar)", async () => {
    witFind.mockResolvedValue([
      { nome: "Sem Email", email: "", cpf: null, mobilePhone: null },
    ]);
    const n = await ensureProposalDefaultWitnesses("p1");
    expect(n).toBe(0);
    expect(signerCreate).not.toHaveBeenCalled();
  });
});
