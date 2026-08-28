import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveBrokerByPhone } from "../broker-identity";
import { prisma } from "@/lib/db/prisma";

const mockPrisma = vi.mocked(prisma);

/**
 * As três travas da resolução telefone→corretor, testadas ONDE ELAS MORAM.
 *
 * Elas já são exercitadas através do `broker-scope` e do `scope-query`, mas
 * indiretamente: a cobertura transitiva prova que as rotas se comportam, não
 * que a intenção do fail-closed está registrada no módulo. Depois da extração
 * (duas rotas, uma implementação), é aqui que alguém vai mexer — e é aqui que o
 * teste precisa estar para explicar por que não se deve "consertar" o caso do
 * telefone duplicado escolhendo um dos dois.
 */

const TELEFONE = "(11) 99906-3228";
const E164 = "+5511999063228";

function corretor(over: Record<string, unknown> = {}) {
  return {
    id: "sr-1",
    label: "Wesley",
    phone: TELEFONE,
    kind: "commissioner",
    active: true,
    notifyOptOut: false,
    pendingFields: [],
    cpfCnpj: null,
    ownerCpfCnpj: null,
    ownerName: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.deal.findMany.mockResolvedValue([] as never);
});

describe("resolveBrokerByPhone", () => {
  it("resolve o corretor atribuído e devolve o escopo de negócios", async () => {
    mockPrisma.splitRecipient.findMany.mockResolvedValue([corretor()] as never);
    mockPrisma.deal.findMany.mockResolvedValue([
      { id: "deal-1", notificationsJson: { brokerIds: ["sr-1"] }, form: null },
    ] as never);

    const r = await resolveBrokerByPhone({ orgId: "org-1", phone: E164 });
    expect(r?.splitRecipientId).toBe("sr-1");
    expect(r?.dealIds).toEqual(["deal-1"]);
  });

  it("telefone DUPLICADO na mesma org é null — nunca escolhe um dos dois", async () => {
    // Sem unique em `SplitRecipient.phone`, duas linhas podem ter o mesmo
    // número, e não há como saber qual delas mandou a mensagem. Devolver a
    // união dos escopos daria a um corretor os negócios do outro; escolher o
    // primeiro arbitraria o escopo de negócio de alguém pela ordem do Postgres.
    mockPrisma.splitRecipient.findMany.mockResolvedValue([
      corretor({ id: "sr-1" }),
      corretor({ id: "sr-2", label: "Outro Wesley" }),
    ] as never);

    expect(await resolveBrokerByPhone({ orgId: "org-1", phone: E164 })).toBeNull();
    // E fail-closed de verdade: não chegou a varrer negócio nenhum.
    expect(mockPrisma.deal.findMany).not.toHaveBeenCalled();
  });

  it("consulta APENAS o roster atribuído e ativo da org", async () => {
    mockPrisma.splitRecipient.findMany.mockResolvedValue([] as never);
    await resolveBrokerByPhone({ orgId: "org-1", phone: E164 });

    // `maxEnabled` é a atribuição explícita da imobiliária, default false: o
    // telefone diz que a pessoa é corretora, só o dono do tenant diz que ela é
    // corretora DA CASA. Sem isto, um corretor de imobiliária parceira que
    // legitimamente recebe aviso de um negócio compartilhado conversaria com o
    // agente e leria dados do tenant.
    expect(mockPrisma.splitRecipient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          orgId: "org-1",
          kind: "commissioner",
          maxEnabled: true,
          active: true,
        },
      })
    );
  });

  it("telefone não normalizável é null, sem tocar o banco", async () => {
    expect(await resolveBrokerByPhone({ orgId: "org-1", phone: "abc" })).toBeNull();
    expect(mockPrisma.splitRecipient.findMany).not.toHaveBeenCalled();
  });
});
