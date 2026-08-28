/**
 * `scope-query` — a porta de leitura de negócio do Max.
 *
 * O que este arquivo protege é a fronteira, não o formato. Três perguntas
 * diferentes, e cada bloco responde uma:
 *
 * 1. O sujeito é quem o Max diz que é? (o `phone` valida o `subject`)
 * 2. O tenant confina a query? (`Deal` não tem `orgId` — vem por `pipeline`)
 * 3. O corretor comissionado recebe MENOS campos? (regra 5, por AUSÊNCIA)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../route";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { CAMPOS_PROIBIDOS_AO_BROKER } from "@/lib/max/scope-projection";

vi.mock("@/lib/auth/impersonation", () => ({
  getImpersonationFor: vi.fn().mockResolvedValue(null),
}));

const mockAuth = vi.mocked(auth);
const mockGetUserOrg = vi.mocked(getUserOrg);
const mockPrisma = vi.mocked(prisma);

const E164 = "+5511999063228";
const TELEFONE = "(11) 99906-3228";

function req(body: unknown, token = "cmt_teste") {
  return new NextRequest("http://localhost/api/agents/scope-query", {
    method: "POST",
    // `cmt_` importa: verifyBearerToken recusa antes do lookup sem o prefixo.
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

/** Um deal completo, como o Prisma o devolveria — todos os campos sensíveis. */
function dealCru(id = "deal-1") {
  return {
    id,
    title: "Apto Rua das Flores, 123 — apto 42",
    clientName: "Maria Silva",
    value: 850000,
    updatedAt: new Date("2026-08-19T14:02:00Z"),
    stage: { name: "Documentação" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(null as never);
  mockGetUserOrg.mockResolvedValue({ id: "org-1" } as never);
  mockPrisma.userApiToken.findUnique.mockResolvedValue({
    id: "tok-1",
    userId: "user-1",
    scopes: ["agents:rw"],
    revokedAt: null,
    expiresAt: null,
  } as never);
  mockPrisma.userApiToken.update.mockResolvedValue({} as never);
  mockPrisma.orgModule.findMany.mockResolvedValue([
    { module: "vendas", enabled: true, featureFlags: { "vendas.max": true } },
  ] as never);
  mockPrisma.certidaoJob.findMany.mockResolvedValue([] as never);
  mockPrisma.deal.findMany.mockResolvedValue([] as never);
  mockPrisma.proposal.findMany.mockResolvedValue([] as never);
  mockPrisma.splitRecipient.findMany.mockResolvedValue([] as never);
});

/** Usuário da plataforma, membro da org de quem pergunta. */
function usuarioResolve(userId = "u-1") {
  mockPrisma.user.findUnique.mockResolvedValue({
    id: userId,
    deletedAt: null,
    orgMemberships: [{ orgId: "org-1" }],
  } as never);
  mockPrisma.orgMembership.findUnique.mockResolvedValue({
    userId,
    orgId: "org-1",
    role: "admin",
    customRole: null,
  } as never);
}

// ── 1. O NEGADO ANTES DO PERMITIDO (regra 3 da governança) ─────────────────

describe("autenticação e superfície", () => {
  it("sessão de navegador é recusada: a rota é máquina-a-máquina", async () => {
    // Sessão válida, sem Bearer — o caminho que um XSS no painel usaria.
    mockAuth.mockResolvedValue({ user: { id: "user-1" } } as never);
    const r = new NextRequest("http://localhost/api/agents/scope-query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        verb: "deal.list",
        subject: { kind: "user", userId: "u-1" },
        phone: E164,
      }),
    });
    const res = await POST(r);
    expect([401, 403]).toContain(res.status);
  });

  it("verbo fora do catálogo é 400, não executa nada", async () => {
    const res = await POST(
      req({
        verb: "deal.delete",
        subject: { kind: "user", userId: "u-1" },
        phone: E164,
      })
    );
    expect(res.status).toBe(400);
    expect(mockPrisma.deal.findMany).not.toHaveBeenCalled();
  });

  it("telefone não normalizável é 400, não varredura", async () => {
    const res = await POST(
      req({
        verb: "deal.list",
        subject: { kind: "user", userId: "u-1" },
        phone: "abc",
      })
    );
    expect(res.status).toBe(400);
    expect(mockPrisma.deal.findMany).not.toHaveBeenCalled();
  });
});

// ── 2. O `phone` VALIDA O `subject` ────────────────────────────────────────

describe("o servidor refaz o vínculo telefone→sujeito", () => {
  it("subject que não confere com o telefone é 403, NÃO lista vazia", async () => {
    // O telefone resolve para u-1; o Max afirmou u-999.
    usuarioResolve("u-1");
    const res = await POST(
      req({
        verb: "deal.list",
        subject: { kind: "user", userId: "u-999" },
        phone: E164,
      })
    );
    // 200 com lista vazia seria pior que inútil: esconderia a divergência e
    // ensinaria o Max a dizer "você não tem negócio" a quem tem.
    expect(res.status).toBe(403);
    expect(mockPrisma.deal.findMany).not.toHaveBeenCalled();
  });

  it("telefone de usuário de OUTRO tenant é 403", async () => {
    // `User.phone` é @unique global: a linha existe, mas sem membership aqui.
    mockPrisma.user.findUnique.mockResolvedValue({
      id: "u-de-outra-org",
      deletedAt: null,
      orgMemberships: [],
    } as never);
    const res = await POST(
      req({
        verb: "deal.list",
        subject: { kind: "user", userId: "u-de-outra-org" },
        phone: E164,
      })
    );
    expect(res.status).toBe(403);
  });

  it("corretor não ATRIBUÍDO ao tenant é 403, mesmo existindo", async () => {
    // `maxEnabled` default false. O roster de atribuídos volta vazio, então o
    // telefone não resolve — é a trava que a spec do scope-query não previa e
    // que veio de graça ao reusar a resolução do broker-scope.
    mockPrisma.splitRecipient.findMany.mockResolvedValue([] as never);
    const res = await POST(
      req({
        verb: "deal.list",
        subject: { kind: "broker", splitRecipientId: "sr-1" },
        phone: TELEFONE,
      })
    );
    expect(res.status).toBe(403);
  });
});

// ── 3. O TENANT CONFINA A QUERY ────────────────────────────────────────────

describe("confinamento por tenant", () => {
  it("o where de deal SEMPRE carrega pipeline.orgId", async () => {
    usuarioResolve("u-1");
    await POST(
      req({
        verb: "deal.list",
        subject: { kind: "user", userId: "u-1" },
        phone: E164,
      })
    );

    expect(mockPrisma.deal.findMany).toHaveBeenCalled();
    const where = mockPrisma.deal.findMany.mock.calls[0][0].where;
    // `Deal` não tem coluna `orgId`; a org vem por `pipeline`. E
    // `dealScopeWhere` devolve `{}` para usuário irrestrito — sem esta linha,
    // um admin leria os negócios de TODAS as orgs.
    expect(where).toMatchObject({ pipeline: { orgId: "org-1" } });
  });

  it("broker: detalhar INTERSECTA o id com a lista de negócios dele", async () => {
    // O caso mais perigoso: para o corretor o escopo JÁ é `id: { in: [...] }`.
    // Se o `negocio_id` sobrescrevesse esse filtro em vez de somar a ele, o
    // corretor leria qualquer negócio da org pedindo o id — IDOR completo,
    // justamente para o sujeito que NÃO tem RBAC atrás.
    mockPrisma.splitRecipient.findMany.mockResolvedValue([
      {
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
      },
    ] as never);
    mockPrisma.deal.findMany
      .mockResolvedValueOnce([
        {
          id: "deal-dele",
          notificationsJson: { brokerIds: ["sr-1"] },
          form: { dataJson: {} },
        },
      ] as never)
      .mockResolvedValueOnce([] as never);

    await POST(
      req({
        verb: "deal.detail",
        subject: { kind: "broker", splitRecipientId: "sr-1" },
        phone: TELEFONE,
        args: { negocio_id: "deal-de-outro" },
      })
    );

    // A segunda chamada é a leitura projetada (a primeira é a varredura de
    // participação feita por resolveBrokerDeals).
    const where = mockPrisma.deal.findMany.mock.calls[1][0].where;
    expect(where).toMatchObject({ pipeline: { orgId: "org-1" } });
    // Os DOIS filtros sobrevivem: pertence à lista dele E é o id pedido.
    expect(where.id).toEqual({ in: ["deal-dele"], equals: "deal-de-outro" });
  });

  it("detalhar INTERSECTA o id com o escopo, nunca o substitui", async () => {
    usuarioResolve("u-1");
    await POST(
      req({
        verb: "deal.detail",
        subject: { kind: "user", userId: "u-1" },
        phone: E164,
        args: { negocio_id: "deal-de-outra-org" },
      })
    );
    const where = mockPrisma.deal.findMany.mock.calls[0][0].where;
    // Se o id substituísse o escopo, isto viraria IDOR: qualquer id de qualquer
    // org seria legível por quem tem o token.
    expect(where).toMatchObject({ pipeline: { orgId: "org-1" } });
    expect(where.id).toBe("deal-de-outra-org");
  });
});

// ── 3b. `deal.pending` É A PERGUNTA SEM ID ─────────────────────────────────

describe("deal.pending responde sem apontar um negócio", () => {
  it("SEM negocio_id ainda consulta, e filtra pendência no where", async () => {
    usuarioResolve("u-1");
    const res = await POST(
      req({
        verb: "deal.pending",
        subject: { kind: "user", userId: "u-1" },
        phone: E164,
      })
    );

    // "Falta algo nos meus negócios?" é a pergunta que o corretor faz sem id, e
    // é a capability que `brokerDefault` concede por padrão. Exigir `negocio_id`
    // aqui devolvia vazio em silêncio para o caso de uso principal.
    expect(res.status).toBe(200);
    expect(mockPrisma.deal.findMany).toHaveBeenCalled();

    const where = mockPrisma.deal.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ pipeline: { orgId: "org-1" } });
    // A pendência entra no WHERE — assim `limite` e `truncated` contam negócios
    // pendentes, e não linhas varridas.
    expect(where.certidaoJobs).toEqual({
      some: { status: { in: ["pending", "fetching", "awaiting_portal"] } },
    });
  });

  it("deal.pending COM negocio_id soma os dois filtros, não troca um pelo outro", async () => {
    // "Este negócio específico está pendente?" — a composição dos dois
    // primitivos já testados em separado. O teste existe para travar a ORDEM de
    // atribuição no `where`: um refactor que montasse o objeto ao contrário
    // poderia perder um dos filtros sem que nenhum outro teste notasse.
    usuarioResolve("u-1");
    await POST(
      req({
        verb: "deal.pending",
        subject: { kind: "user", userId: "u-1" },
        phone: E164,
        args: { negocio_id: "deal-x" },
      })
    );

    const where = mockPrisma.deal.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ pipeline: { orgId: "org-1" } });
    expect(where.id).toBe("deal-x");
    expect(where.certidaoJobs).toEqual({
      some: { status: { in: ["pending", "fetching", "awaiting_portal"] } },
    });
  });

  it("deal.detail SEM negocio_id não consulta nada", async () => {
    usuarioResolve("u-1");
    const res = await POST(
      req({
        verb: "deal.detail",
        subject: { kind: "user", userId: "u-1" },
        phone: E164,
      })
    );
    expect(res.status).toBe(200);
    expect((await res.json()).items).toEqual([]);
    // Detalhar sem dizer o quê não é uma pergunta; é um pedido malformado que
    // não deve custar uma varredura.
    expect(mockPrisma.deal.findMany).not.toHaveBeenCalled();
  });
});

// ── 4. PROJEÇÃO POR SUJEITO — AFIRMADA POR AUSÊNCIA (regra 5) ──────────────

describe("projeção por tipo de sujeito", () => {
  it("o corretor comissionado NÃO recebe os campos proibidos", async () => {
    // Campos completos: `isEligible` exige kind=commissioner, sem optOut e
    // ativo — um roster incompleto faz o match falhar em silêncio.
    mockPrisma.splitRecipient.findMany.mockResolvedValue([
      {
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
      },
    ] as never);
    // resolveBrokerDeals varre deals da org; devolve o deal em que participa.
    mockPrisma.deal.findMany
      .mockResolvedValueOnce([
        {
          id: "deal-1",
          notificationsJson: { brokerIds: ["sr-1"] },
          form: { dataJson: {} },
        },
      ] as never)
      .mockResolvedValueOnce([dealCru("deal-1")] as never);

    const res = await POST(
      req({
        verb: "deal.list",
        subject: { kind: "broker", splitRecipientId: "sr-1" },
        phone: TELEFONE,
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);

    const item = body.items[0];
    // AUSÊNCIA, não presença. Um teste de presença continua verde no dia em
    // que alguém acrescenta um campo novo que vaza.
    for (const proibido of CAMPOS_PROIBIDOS_AO_BROKER) {
      expect(item).not.toHaveProperty(proibido);
    }
    // E o valor não pode aparecer sob OUTRO nome: a serialização inteira não
    // pode conter o endereço nem o nome do cliente.
    const serializado = JSON.stringify(item);
    expect(serializado).not.toContain("Rua das Flores");
    expect(serializado).not.toContain("Maria Silva");
    expect(serializado).not.toContain("850000");

    // O que ele PRECISA ter para conversar sobre o negócio.
    // `referencia` deriva do id (cuid), não de contador: um sequencial por org
    // revelaria o VOLUME da imobiliária a quem não é da casa.
    expect(item.referencia).toBe("Negócio #DEAL-1");
    expect(item.etapa).toBe("Documentação");
  });

  it("o usuário da plataforma recebe os campos de negócio", async () => {
    usuarioResolve("u-1");
    mockPrisma.deal.findMany.mockResolvedValue([dealCru("deal-1")] as never);

    const res = await POST(
      req({
        verb: "deal.list",
        subject: { kind: "user", userId: "u-1" },
        phone: E164,
      })
    );
    const body = await res.json();
    const item = body.items[0];
    expect(item.cliente).toBe("Maria Silva");
    expect(item.valor).toBe(850000);
    expect(item.titulo).toContain("Rua das Flores");
  });
});
