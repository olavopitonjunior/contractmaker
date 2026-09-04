import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";

vi.mock("@/lib/asaas/commissioner-registry", () => ({
  upsertCommissionerFromFormData: vi.fn(),
}));
vi.mock("@/lib/security/audit", () => ({
  audit: vi.fn().mockResolvedValue(undefined),
}));

import { upsertCommissionerFromFormData } from "@/lib/asaas/commissioner-registry";
import { audit } from "@/lib/security/audit";
import { autoRegisterProposalCommissioners } from "../auto-register-commissioners";

const proposalFind = prisma.proposal.findUnique as unknown as ReturnType<typeof vi.fn>;
const executeRaw = prisma.$executeRaw as unknown as ReturnType<typeof vi.fn>;
const upsert = upsertCommissionerFromFormData as unknown as ReturnType<typeof vi.fn>;

function row(over: Record<string, unknown> = {}) {
  return {
    id: "p1",
    orgId: "org1",
    dataJson: {
      compradores: [{ nome: "Maria" }],
      corretores_parceiros: [
        { nome: "Carla", creci: "1-F/SP", email: "c@x.com" },
        { nome: "Já Cadastrado", splitRecipientId: "sr-old" },
      ],
    },
    ...over,
  };
}

/** Argumentos do tagged template `$executeRaw` → (strings, ...values). */
function rawCall(): { sql: string; values: unknown[] } {
  const [strings, ...values] = executeRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
  return { sql: strings.join("?"), values };
}

describe("autoRegisterProposalCommissioners", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeRaw.mockResolvedValue(1);
  });

  it("cadastra só quem não tem splitRecipientId e backfilla via jsonb_set na chave própria", async () => {
    proposalFind.mockResolvedValue(row());
    upsert.mockResolvedValue({ id: "sr-new", existed: false });

    await autoRegisterProposalCommissioners({ proposalId: "p1", orgId: "org1" });

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(
      "org1",
      expect.objectContaining({ nome: "Carla", creci: "1-F/SP", email: "c@x.com", papel: "intermediador" })
    );
    expect(executeRaw).toHaveBeenCalledTimes(1);
    const { sql, values } = rawCall();
    // Só a chave dos parceiros é escrita — nunca o blob inteiro.
    expect(sql).toContain("jsonb_set(");
    expect(sql).toContain("'{corretores_parceiros}'");
    expect(sql).not.toContain("comissao");
    expect(JSON.parse(values[0] as string)).toEqual([
      { nome: "Carla", creci: "1-F/SP", email: "c@x.com", splitRecipientId: "sr-new" },
      { nome: "Já Cadastrado", splitRecipientId: "sr-old" },
    ]);
    expect(values[1]).toBe("p1");
    // Cadastro NOVO → audit; match em existente não audita.
    expect(audit).toHaveBeenCalledTimes(1);
  });

  it("match em cadastro existente não audita, mas backfilla o id", async () => {
    proposalFind.mockResolvedValue(row());
    upsert.mockResolvedValue({ id: "sr-match", existed: true });
    await autoRegisterProposalCommissioners({ proposalId: "p1", orgId: "org1" });
    expect(audit).not.toHaveBeenCalled();
    expect(JSON.parse(rawCall().values[0] as string)[0].splitRecipientId).toBe("sr-match");
  });

  it("falha de um upsert não aborta o lote nem lança", async () => {
    proposalFind.mockResolvedValue(
      row({
        dataJson: {
          corretores_parceiros: [{ nome: "A" }, { nome: "B" }],
        },
      })
    );
    upsert.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce({ id: "sr-b", existed: true });
    await expect(
      autoRegisterProposalCommissioners({ proposalId: "p1", orgId: "org1" })
    ).resolves.toBeUndefined();
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(JSON.parse(rawCall().values[0] as string)).toEqual([
      { nome: "A" },
      { nome: "B", splitRecipientId: "sr-b" },
    ]);
  });

  it("sem parceiros, todos já cadastrados, ou org errada → nenhuma escrita", async () => {
    proposalFind.mockResolvedValue(row({ dataJson: { compradores: [] } }));
    await autoRegisterProposalCommissioners({ proposalId: "p1", orgId: "org1" });
    proposalFind.mockResolvedValue(
      row({ dataJson: { corretores_parceiros: [{ nome: "X", splitRecipientId: "s" }] } })
    );
    await autoRegisterProposalCommissioners({ proposalId: "p1", orgId: "org1" });
    proposalFind.mockResolvedValue(row({ orgId: "org2" }));
    await autoRegisterProposalCommissioners({ proposalId: "p1", orgId: "org1" });
    expect(upsert).not.toHaveBeenCalled();
    expect(executeRaw).not.toHaveBeenCalled();
  });
});
