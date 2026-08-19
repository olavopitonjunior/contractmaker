/**
 * REGRESSÃO: rotas de deal sob impersonation de tenant.
 *
 * O super_admin "testando como" um tenant NÃO tem OrgMembership na org
 * impersonada. Enquanto estas rotas resolviam identidade com `auth()` cru,
 * `getEffectivePermissions(session.user.id, org.id)` voltava null e TODA rota
 * de deal respondia 404 — o admin entrava no tenant e não conseguia abrir,
 * apagar ou gerar contrato de nenhum negócio. Descoberto ao montar a
 * biblioteca de contratos da RE/MAX Trio em produção (19/08/2026).
 *
 * O contrato correto: `requireAuth` sobrepõe a identidade e o ator efetivo
 * passa a ser o DONO do tenant — é ele que resolve membership/RBAC e é ele que
 * assina o que for criado. O admin real fica em `impersonatedByUserId` e é
 * carimbado no AuditLog por `audit()`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

const ADMIN_ID = "user-super-admin";
const OWNER_ID = "user-dono-do-tenant";
const ORG_ID = "org-tenant";
const DEAL_ID = "deal-1";

const getImpersonationForMock = vi.fn();
vi.mock("@/lib/auth/impersonation", () => ({
  getImpersonationFor: (...args: unknown[]) => getImpersonationForMock(...args),
  getEffectiveUserId: vi.fn(),
  getImpersonationAuditMeta: vi.fn().mockResolvedValue(null),
  isImpersonating: vi.fn(),
}));

const getEffectivePermissionsMock = vi.fn();
vi.mock("@/lib/security/rbac/check", () => ({
  getEffectivePermissions: (...args: unknown[]) =>
    getEffectivePermissionsMock(...args),
  canAccessDeal: () => true,
  can: () => true,
}));

const generateContractMock = vi.fn();
const generateLocacaoContractMock = vi.fn();
vi.mock("@/lib/services/contract-generation", () => ({
  generateContractForDeal: (...args: unknown[]) => generateContractMock(...args),
  generateLocacaoContractForDeal: (...args: unknown[]) =>
    generateLocacaoContractMock(...args),
}));

const guardDealScopeMock = vi.fn();
vi.mock("@/lib/deals/route-helpers", () => ({
  guardDealScope: (...args: unknown[]) => guardDealScopeMock(...args),
}));

import { GET, PATCH, DELETE } from "../route";
import { POST as generateContract } from "../generate-contract/route";
import { POST as archive } from "../archive/route";
import { DELETE as deleteContracts } from "../contracts/route";
import { POST as markCommissionPaid } from "../mark-commission-paid/route";
import { POST as markLost } from "../mark-lost/route";
import { POST as markSigned } from "../mark-signed/route";
import { POST as reopen } from "../reopen/route";

const mockAuth = vi.mocked(auth);
const mockGetUserOrg = vi.mocked(getUserOrg);
const mockPrisma = vi.mocked(prisma);

/** Sessão do super_admin + cookie de impersonation ativo no tenant. */
function impersonatingTenant() {
  mockAuth.mockResolvedValue({
    user: { id: ADMIN_ID, email: "admin@plataforma.com.br" },
  } as never);
  getImpersonationForMock.mockResolvedValue({
    orgId: ORG_ID,
    ownerUserId: OWNER_ID,
  });
  mockPrisma.organization.findUnique.mockResolvedValue({
    id: ORG_ID,
    name: "RE/MAX Tenant",
  } as never);
  mockPrisma.user.findUnique.mockResolvedValue({
    email: "dono@tenant.com.br",
    name: "Dono",
  } as never);
}

const dealRow = {
  id: DEAL_ID,
  userId: OWNER_ID,
  managerUserId: null,
  kind: "locacao",
  formId: null,
  archivedAt: null,
  stage: { id: "s1", name: "Lead" },
  form: null,
  attachments: [],
  contracts: [],
  envelopes: [],
  certidaoJobs: [],
  pipeline: { orgId: ORG_ID, kind: "locacao", stages: [] },
};

beforeEach(() => {
  vi.clearAllMocks();
  getImpersonationForMock.mockResolvedValue(null);
  getEffectivePermissionsMock.mockResolvedValue({ role: "owner" });
  guardDealScopeMock.mockResolvedValue(null);
  mockPrisma.deal.findUnique.mockResolvedValue(dealRow as never);
});

describe("GET /api/pipeline/deals/[dealId] sob impersonation", () => {
  it("resolve o RBAC pelo DONO do tenant, não pelo super_admin", async () => {
    impersonatingTenant();

    const res = await GET(
      new NextRequest(`http://localhost/api/pipeline/deals/${DEAL_ID}`),
      { params: { dealId: DEAL_ID } }
    );

    expect(res.status).toBe(200);
    // O bug: era chamado com ADMIN_ID, que não tem membership → null → 404.
    expect(getEffectivePermissionsMock).toHaveBeenCalledWith(OWNER_ID, ORG_ID);
    expect(getEffectivePermissionsMock).not.toHaveBeenCalledWith(
      ADMIN_ID,
      expect.anything()
    );
  });

  it("404 quando o ator efetivo não tem permissão na org", async () => {
    impersonatingTenant();
    getEffectivePermissionsMock.mockResolvedValue(null);

    const res = await GET(
      new NextRequest(`http://localhost/api/pipeline/deals/${DEAL_ID}`),
      { params: { dealId: DEAL_ID } }
    );

    expect(res.status).toBe(404);
  });

  it("sem impersonation, segue resolvendo pelo próprio usuário", async () => {
    mockAuth.mockResolvedValue({
      user: { id: OWNER_ID, email: "dono@tenant.com.br" },
    } as never);
    // Sem impersonation a org vem de `getUserOrg` (membership do próprio user).
    mockGetUserOrg.mockResolvedValue({
      id: ORG_ID,
      name: "RE/MAX Tenant",
    } as never);

    const res = await GET(
      new NextRequest(`http://localhost/api/pipeline/deals/${DEAL_ID}`),
      { params: { dealId: DEAL_ID } }
    );

    expect(res.status).toBe(200);
    expect(getEffectivePermissionsMock).toHaveBeenCalledWith(OWNER_ID, ORG_ID);
  });
});

/**
 * As demais rotas mutadoras entregam o ator ao `guardDealScope`. Aqui o guard é
 * mockado pra NEGAR: cada rota retorna logo depois dele, então o teste isola
 * exatamente a pergunta que importa — "que id chegou no RBAC?" — sem precisar
 * mockar a cascata de efeitos de cada handler.
 */
describe("rotas mutadoras de deal passam o ator EFETIVO pro RBAC", () => {
  const DENY = NextResponse.json({ error: "negado" }, { status: 403 });

  function reqFor(path: string, body?: unknown) {
    return new NextRequest(
      `http://localhost/api/pipeline/deals/${DEAL_ID}/${path}`,
      {
        method: "POST",
        ...(body
          ? {
              body: JSON.stringify(body),
              headers: { "Content-Type": "application/json" },
            }
          : {}),
      }
    );
  }

  const cases: Array<{
    name: string;
    run: () => Promise<Response>;
  }> = [
    {
      name: "archive",
      run: () =>
        archive(reqFor("archive", { archived: true }), {
          params: { dealId: DEAL_ID },
        }),
    },
    {
      name: "contracts (DELETE)",
      run: () =>
        deleteContracts(
          new NextRequest(
            `http://localhost/api/pipeline/deals/${DEAL_ID}/contracts`,
            { method: "DELETE" }
          ),
          { params: { dealId: DEAL_ID } }
        ),
    },
    {
      name: "mark-commission-paid",
      run: () =>
        markCommissionPaid(reqFor("mark-commission-paid"), {
          params: { dealId: DEAL_ID },
        }),
    },
    {
      name: "mark-lost",
      run: () =>
        markLost(reqFor("mark-lost", { reason: "cliente desistiu" }), {
          params: { dealId: DEAL_ID },
        }),
    },
    {
      name: "mark-signed",
      run: () =>
        markSigned(reqFor("mark-signed"), { params: { dealId: DEAL_ID } }),
    },
    {
      name: "reopen",
      run: () => reopen(reqFor("reopen"), { params: { dealId: DEAL_ID } }),
    },
  ];

  for (const c of cases) {
    it(`${c.name}: guardDealScope recebe o dono do tenant`, async () => {
      impersonatingTenant();
      guardDealScopeMock.mockResolvedValue(DENY);

      await c.run();

      expect(guardDealScopeMock).toHaveBeenCalledWith(
        expect.objectContaining({ userId: OWNER_ID, orgId: ORG_ID })
      );
    });
  }

  it("PATCH [dealId]: RBAC resolvido pelo dono do tenant", async () => {
    impersonatingTenant();
    getEffectivePermissionsMock.mockResolvedValue(null); // corta antes de escrever

    const res = await PATCH(
      new NextRequest(`http://localhost/api/pipeline/deals/${DEAL_ID}`, {
        method: "PATCH",
        body: JSON.stringify({ title: "novo título" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: { dealId: DEAL_ID } }
    );

    expect(res.status).toBe(404);
    expect(getEffectivePermissionsMock).toHaveBeenCalledWith(OWNER_ID, ORG_ID);
  });

  it("DELETE [dealId]: RBAC resolvido pelo dono do tenant antes da cascata", async () => {
    impersonatingTenant();
    getEffectivePermissionsMock.mockResolvedValue(null);

    const res = await DELETE(
      new NextRequest(`http://localhost/api/pipeline/deals/${DEAL_ID}`, {
        method: "DELETE",
      }),
      { params: { dealId: DEAL_ID } }
    );

    expect(res.status).toBe(404);
    expect(getEffectivePermissionsMock).toHaveBeenCalledWith(OWNER_ID, ORG_ID);
    // A cascata destrutiva não pode ter começado.
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("POST /api/pipeline/deals/[dealId]/generate-contract sob impersonation", () => {
  it("gera o contrato assinado pelo DONO do tenant", async () => {
    impersonatingTenant();
    generateLocacaoContractMock.mockResolvedValue({ contractId: "c1" });

    const res = await generateContract(
      new NextRequest(
        `http://localhost/api/pipeline/deals/${DEAL_ID}/generate-contract`,
        { method: "POST" }
      ),
      { params: { dealId: DEAL_ID } }
    );

    expect(res.status).toBe(201);
    // Autoria do contrato: o dono do tenant, nunca o super_admin (que fica no
    // AuditLog via metadata.impersonatedBy).
    expect(generateLocacaoContractMock).toHaveBeenCalledWith(
      DEAL_ID,
      OWNER_ID,
      ORG_ID
    );
  });
});
