import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    orgMembership: { findMany: vi.fn() },
    deal: { groupBy: vi.fn() },
    user: { findMany: vi.fn() },
  },
}));

import { getResponsavelOptions } from "../responsaveis";
import { prisma } from "@/lib/db/prisma";

const membershipFindMany = vi.mocked(prisma.orgMembership.findMany);
const dealGroupBy = vi.mocked(prisma.deal.groupBy);
const userFindMany = vi.mocked(prisma.user.findMany);

const ARGS = { orgId: "org1", pipelineId: "pipe1" };

/** groupBy é chamado 2x: criadores (userId) e gerentes (managerUserId). */
function mockDeals(creators: string[], managers: string[]) {
  dealGroupBy
    .mockResolvedValueOnce(creators.map((userId) => ({ userId })) as never)
    .mockResolvedValueOnce(
      managers.map((managerUserId) => ({ managerUserId })) as never
    );
}

beforeEach(() => {
  vi.clearAllMocks();
  userFindMany.mockResolvedValue([] as never);
});

describe("getResponsavelOptions", () => {
  it("inclui membro da org que nunca criou nem gerenciou negócio", async () => {
    // O bug original: Garrido é membro, tem zero deals criados, sumia do select.
    membershipFindMany.mockResolvedValue([
      { user: { id: "u-garrido", name: "Garrido", email: "g@x.com" } },
    ] as never);
    mockDeals([], []);

    const out = await getResponsavelOptions(ARGS);

    expect(out).toEqual([{ id: "u-garrido", label: "Garrido" }]);
  });

  it("inclui ex-membro que ainda é gerente de um negócio", async () => {
    membershipFindMany.mockResolvedValue([
      { user: { id: "u1", name: "Ana", email: "ana@x.com" } },
    ] as never);
    mockDeals([], ["u-ex"]);
    userFindMany.mockResolvedValue([
      { id: "u-ex", name: "Bruno Ex", email: "bruno@x.com" },
    ] as never);

    const out = await getResponsavelOptions(ARGS);

    expect(userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ["u-ex"] } }),
      })
    );
    expect(out.map((o) => o.id)).toEqual(["u1", "u-ex"]);
  });

  it("não duplica quem é membro E criador, e ordena por label", async () => {
    membershipFindMany.mockResolvedValue([
      { user: { id: "u-z", name: "Zeca", email: "z@x.com" } },
      { user: { id: "u-a", name: "Ana", email: "a@x.com" } },
    ] as never);
    mockDeals(["u-a"], []);
    userFindMany.mockResolvedValue([
      { id: "u-a", name: "Ana", email: "a@x.com" },
    ] as never);

    const out = await getResponsavelOptions(ARGS);

    expect(out).toEqual([
      { id: "u-a", label: "Ana" },
      { id: "u-z", label: "Zeca" },
    ]);
  });

  it("exclui memberships de sistema e usuários deletados na query", async () => {
    membershipFindMany.mockResolvedValue([] as never);
    mockDeals([], []);

    await getResponsavelOptions(ARGS);

    expect(membershipFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orgId: "org1", isSystem: false, user: { deletedAt: null } },
      })
    );
    // Sem ninguém em deals, não paga o findMany de usuários.
    expect(userFindMany).not.toHaveBeenCalled();
  });

  // Deal aberto via Bearer nasce com userId do usuário de serviço, e conta
  // apagada por LGPD só ganha deletedAt (nome/e-mail continuam lá). Os dois
  // voltariam pela união se ela não repetisse os cortes da membership.
  it("corta usuário de serviço e conta deletada também no lado dos deals", async () => {
    membershipFindMany.mockResolvedValue([] as never);
    mockDeals(["u-bot"], []);

    await getResponsavelOptions(ARGS);

    expect(userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: ["u-bot"] },
          deletedAt: null,
          orgMemberships: { none: { orgId: "org1", isSystem: true } },
        },
      })
    );
  });

  it("quem tem negócio cai pro e-mail quando não tem nome (igual ao card)", async () => {
    membershipFindMany.mockResolvedValue([] as never);
    mockDeals(["u1"], []);
    userFindMany.mockResolvedValue([
      { id: "u1", name: "   ", email: "sem-nome@x.com" },
    ] as never);

    const out = await getResponsavelOptions(ARGS);

    expect(out).toEqual([{ id: "u1", label: "sem-nome@x.com" }]);
  });

  // Convidado que nunca entrou costuma ter name null e zero negócio: viraria
  // opção que não casa card nenhum, expondo um e-mail à toa.
  it("omite membro sem nome e sem negócio em vez de expor o e-mail", async () => {
    membershipFindMany.mockResolvedValue([
      { user: { id: "u-convidado", name: null, email: "convidado@x.com" } },
      { user: { id: "u-ana", name: "Ana", email: "ana@x.com" } },
    ] as never);
    mockDeals([], []);

    const out = await getResponsavelOptions(ARGS);

    expect(out).toEqual([{ id: "u-ana", label: "Ana" }]);
  });
});
