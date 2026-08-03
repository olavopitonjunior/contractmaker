/**
 * Escopo de negócio do corretor, do ponto de vista do agente de WhatsApp.
 *
 * O que este arquivo protege não é o formato da resposta — é a fronteira. Um
 * corretor é membro legítimo do tenant; o que ele não é, necessariamente, é
 * parte daquele negócio. E o mesmo telefone pode ser corretor em duas
 * imobiliárias ao mesmo tempo, porque `SplitRecipient.phone` não tem unique
 * nenhum.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../route";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

vi.mock("@/lib/auth/impersonation", () => ({
  getImpersonationFor: vi.fn().mockResolvedValue(null),
}));

const mockAuth = vi.mocked(auth);
const mockGetUserOrg = vi.mocked(getUserOrg);
const mockPrisma = vi.mocked(prisma);

const TELEFONE = "(11) 99906-3228";
const E164 = "+5511999063228";

function req(phone: string) {
  return new NextRequest(
    `http://localhost/api/agents/broker-scope?phone=${encodeURIComponent(phone)}`,
    // `cmt_` importa: verifyBearerToken recusa antes do lookup sem o prefixo.
    { headers: { authorization: "Bearer cmt_teste" } }
  );
}

function roster(rows: Array<Record<string, unknown>>) {
  // A rota faz dois findMany em SplitRecipient: o primeiro é o filtro de
  // atribuídos (select estreito), o segundo é o registry inteiro que
  // resolveBrokerDeals indexa.
  mockPrisma.splitRecipient.findMany.mockResolvedValue(rows as never);
}

function deals(rows: Array<Record<string, unknown>>) {
  mockPrisma.deal.findMany.mockResolvedValue(rows as never);
}

/** Deal com um comissionado identificado por CPF no dataJson do form. */
function dealComCpf(id: string, cpf: string) {
  return {
    id,
    notificationsJson: null,
    form: { dataJson: { comissao: { comissionados: [{ nome: "X", cpf }] } } },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(null as never);
  mockGetUserOrg.mockResolvedValue({ id: "org-1" } as never);
  mockPrisma.userApiToken.findUnique.mockResolvedValue({
    id: "tok-1",
    userId: "user-1",
    scopes: ["agents:r"],
    revokedAt: null,
    expiresAt: null,
  } as never);
  mockPrisma.userApiToken.update.mockResolvedValue({} as never);
  // Tenant com o Max contratado — sem isto o gate de entitlement dá 403.
  mockPrisma.orgModule.findMany.mockResolvedValue([
    { module: "vendas", enabled: true, featureFlags: { "vendas.max": true } },
  ] as never);
  deals([]);
});

describe("identificação do corretor", () => {
  it("corretor atribuído devolve seu id e rótulo", async () => {
    roster([
      { id: "sr-1", label: "Carlos", phone: TELEFONE, kind: "commissioner", active: true, cpfCnpj: null, ownerCpfCnpj: null, ownerName: null, notifyOptOut: false, pendingFields: [] },
    ]);

    const res = await GET(req(E164));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.splitRecipientId).toBe("sr-1");
    expect(body.label).toBe("Carlos");
  });

  it("casa o E.164 recebido com o formato livre do cadastro", async () => {
    roster([
      { id: "sr-1", label: "Carlos", phone: "(11) 99906-3228", kind: "commissioner", active: true, cpfCnpj: null, ownerCpfCnpj: null, ownerName: null, notifyOptOut: false, pendingFields: [] },
    ]);

    // O cadastro guarda máscara; o webhook do gateway entrega E.164. Se o
    // match fosse por igualdade de string, nenhum corretor seria reconhecido.
    expect((await GET(req(E164))).status).toBe(200);
  });

  /**
   * O `where` da rota já filtra `maxEnabled: true`, então um corretor não
   * atribuído simplesmente não volta do banco — este teste prova que a
   * ausência vira 404 e não uma resposta vazia de escopo aberto.
   */
  it("corretor sem atribuição da imobiliária dá 404", async () => {
    roster([]);

    const res = await GET(req(E164));

    expect(res.status).toBe(404);
    const where = mockPrisma.splitRecipient.findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(where.where.maxEnabled).toBe(true);
    expect(where.where.active).toBe(true);
    expect(where.where.orgId).toBe("org-1");
  });

  /**
   * Sem unique em `phone`, duas linhas da MESMA org podem ter o mesmo número e
   * não há como saber qual mandou a mensagem. Devolver a união daria a um
   * corretor os negócios do outro.
   */
  it("telefone duplicado dentro da org dá 404, não a união dos escopos", async () => {
    roster([
      { id: "sr-1", label: "Carlos", phone: TELEFONE },
      { id: "sr-2", label: "Carlos Filho", phone: "11999063228" },
    ]);

    const res = await GET(req(E164));

    expect(res.status).toBe(404);
    // E não chegou a varrer negócio nenhum.
    expect(mockPrisma.deal.findMany).not.toHaveBeenCalled();
  });

  it("telefone não normalizável é 400, não varredura", async () => {
    roster([]);

    const res = await GET(req("123"));

    expect(res.status).toBe(400);
    expect(mockPrisma.splitRecipient.findMany).not.toHaveBeenCalled();
  });

  /**
   * Mesmo motivo do `by-phone`: distinguir "não existe" de "existe em outro
   * tenant" confirma um cadastro para quem tem token de outra org.
   */
  it("não atribuído e inexistente devolvem a MESMA resposta", async () => {
    roster([]);
    const a = await GET(req(E164));
    const corpoA = await a.json();

    roster([]);
    const b = await GET(req("+5511911111111"));
    const corpoB = await b.json();

    expect(a.status).toBe(b.status);
    expect(corpoA).toEqual(corpoB);
  });
});

describe("escopo de negócio", () => {
  const CORRETOR = {
    id: "sr-1",
    label: "Carlos",
    phone: TELEFONE,
    kind: "commissioner",
    active: true,
    cpfCnpj: "111.444.777-35",
    ownerCpfCnpj: null,
    ownerName: null,
    notifyOptOut: false,
    pendingFields: [],
  };

  it("devolve só os negócios em que o corretor é comissionado", async () => {
    roster([CORRETOR]);
    deals([
      dealComCpf("deal-meu", "11144477735"),
      dealComCpf("deal-de-outro", "52998224725"),
    ]);

    const body = await (await GET(req(E164))).json();

    expect(body.dealIds).toEqual(["deal-meu"]);
  });

  it("negócio sem comissionado e sem brokerIds não entra", async () => {
    roster([CORRETOR]);
    deals([{ id: "deal-vazio", notificationsJson: null, form: null }]);

    const body = await (await GET(req(E164))).json();

    expect(body.dealIds).toEqual([]);
  });

  it("brokerId explícito do deal conta", async () => {
    roster([CORRETOR]);
    deals([
      { id: "deal-override", notificationsJson: { brokerIds: ["sr-1"] }, form: null },
    ]);

    const body = await (await GET(req(E164))).json();

    expect(body.dealIds).toEqual(["deal-override"]);
  });

  /**
   * O invariante que motivou implementar o inverso RODANDO a resolução direta:
   * dois recipients com o mesmo nome, o direto entrega o deal ao ativo. Um
   * inverso ingênuo (casar nome contra o corretor) entregaria aos dois — e o
   * desativado veria negócio que não é dele.
   */
  it("o inverso não é mais permissivo que o direto em nome duplicado", async () => {
    const INATIVO = {
      ...CORRETOR,
      id: "sr-2",
      cpfCnpj: null,
      label: "Carlos",
      active: false,
      pendingFields: [],
    };
    // `maxEnabled` do inativo é irrelevante: o filtro de identificação já o
    // exclui. O que importa é o registry que a resolução indexa.
    mockPrisma.splitRecipient.findMany
      .mockResolvedValueOnce([CORRETOR] as never)
      .mockResolvedValueOnce([{ ...CORRETOR, label: "Carlos" }, INATIVO] as never);
    deals([
      {
        id: "deal-nome",
        notificationsJson: null,
        form: { dataJson: { comissao: { comissionados: [{ nome: "Carlos" }] } } },
      },
    ]);

    const body = await (await GET(req(E164))).json();

    // O ativo leva; o deal aparece uma vez só, para ele.
    expect(body.dealIds).toEqual(["deal-nome"]);
  });

  /**
   * "Não olhei além daqui" é diferente de "não participa de mais nenhum", e
   * quem consome precisa saber qual dos dois recebeu.
   */
  it("sinaliza corte quando há mais negócios que o limite", async () => {
    roster([CORRETOR]);
    // A rota não passa `limit`, então vale o padrão de 200 — a query pede
    // 201 justamente para conseguir distinguir "acabou" de "cortei".
    deals(
      Array.from({ length: 201 }, (_, i) => dealComCpf(`d-${i}`, "11144477735"))
    );

    const body = await (await GET(req(E164))).json();

    expect(body.truncated).toBe(true);
    expect(body.scanned).toBe(200);
    expect(body.dealIds).toHaveLength(200);
  });
});

describe("fronteira do tenant", () => {
  it("a varredura de negócios é escopada pela org do token", async () => {
    roster([
      { id: "sr-1", label: "Carlos", phone: TELEFONE, kind: "commissioner", active: true, cpfCnpj: null, ownerCpfCnpj: null, ownerName: null, notifyOptOut: false, pendingFields: [] },
    ]);

    await GET(req(E164));

    const args = mockPrisma.deal.findMany.mock.calls[0][0] as {
      where: { pipeline: { orgId: string } };
    };
    // Deal não tem orgId direto — o escopo é via pipeline.
    expect(args.where.pipeline.orgId).toBe("org-1");
  });

  it("tenant sem o Max contratado recebe 403 antes de qualquer leitura", async () => {
    mockPrisma.orgModule.findMany.mockResolvedValue([
      { module: "vendas", enabled: true, featureFlags: {} },
    ] as never);
    roster([]);

    const res = await GET(req(E164));

    expect(res.status).toBe(403);
    expect(mockPrisma.splitRecipient.findMany).not.toHaveBeenCalled();
  });

  it("token sem agents:r não passa", async () => {
    mockPrisma.userApiToken.findUnique.mockResolvedValue({
      id: "tok-1",
      userId: "user-1",
      scopes: ["metrics:r"],
      revokedAt: null,
      expiresAt: null,
    } as never);

    expect((await GET(req(E164))).status).toBe(403);
  });
});
