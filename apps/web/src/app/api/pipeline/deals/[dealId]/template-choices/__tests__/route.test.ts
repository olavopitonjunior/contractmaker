/**
 * A lista que o diálogo mostra e o que o POST de geração aceita têm que ser a
 * MESMA regra — senão a UI oferece um modelo que a rota recusa (ou esconde um
 * que ela aceitaria). Por isso as duas passam por
 * `eligibleModalidadesForDealKind`, e este teste trava o contrato do filtro.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

vi.mock("@/lib/auth/impersonation", () => ({
  getImpersonationFor: vi.fn().mockResolvedValue(null),
  getEffectiveUserId: vi.fn(async (id: string) => id),
  getImpersonationAuditMeta: vi.fn().mockResolvedValue(null),
  isImpersonating: vi.fn(),
}));

const guardDealScopeMock = vi.fn();
vi.mock("@/lib/deals/route-helpers", () => ({
  guardDealScope: (...args: unknown[]) => guardDealScopeMock(...args),
}));

import { GET } from "../route";

const ORG_ID = "org-1";
const DEAL_ID = "deal-1";
const mockAuth = vi.mocked(auth);
const mockGetUserOrg = vi.mocked(getUserOrg);
const mockPrisma = vi.mocked(prisma);

const req = () =>
  new NextRequest(
    `http://localhost/api/pipeline/deals/${DEAL_ID}/template-choices`
  );

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "u1" } } as never);
  mockGetUserOrg.mockResolvedValue({ id: ORG_ID, name: "Org" } as never);
  guardDealScopeMock.mockResolvedValue(null);
  mockPrisma.contractTemplate.findMany.mockResolvedValue([] as never);
});

describe("GET /api/pipeline/deals/[dealId]/template-choices", () => {
  it("locação: consulta só as modalidades elegíveis, SEM administração de locação", async () => {
    mockPrisma.deal.findUnique.mockResolvedValue({ kind: "locacao" } as never);

    await GET(req(), { params: { dealId: DEAL_ID } });

    const where = mockPrisma.contractTemplate.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ orgId: ORG_ID, status: "active" });
    const modalidades = (where.modalidade as { in: string[] }).in;
    expect(modalidades).toContain("locacao");
    expect(modalidades).toContain("locacao_comercial");
    // Outro instrumento — não pode virar o contrato do inquilino.
    expect(modalidades).not.toContain("administracao_locacao");
  });

  it("venda: só as modalidades de venda", async () => {
    mockPrisma.deal.findUnique.mockResolvedValue({ kind: "venda" } as never);

    await GET(req(), { params: { dealId: DEAL_ID } });

    const where = mockPrisma.contractTemplate.findMany.mock.calls[0][0].where;
    expect((where.modalidade as { in: string[] }).in).toEqual([
      "a_vista",
      "financiamento",
    ]);
  });

  it("devolve rótulo e badges de critério pra o operador saber o que é cada modelo", async () => {
    mockPrisma.deal.findUnique.mockResolvedValue({ kind: "locacao" } as never);
    mockPrisma.contractTemplate.findMany.mockResolvedValue([
      {
        id: "t1",
        name: "Locação Residencial — Administração",
        modalidade: "locacao",
        isDefault: false,
        matchCriteria: { admImobiliaria: true },
      },
    ] as never);

    const body = await (await GET(req(), { params: { dealId: DEAL_ID } })).json();

    expect(body.dealKind).toBe("locacao");
    expect(body.templates[0]).toMatchObject({
      id: "t1",
      modalidadeLabel: "Locação residencial",
      criteria: ["Com administração"],
    });
  });

  it("aplica o MESMO gate da geração — sem permissão, sem lista", async () => {
    mockPrisma.deal.findUnique.mockResolvedValue({ kind: "locacao" } as never);
    const { NextResponse } = await import("next/server");
    guardDealScopeMock.mockResolvedValue(
      NextResponse.json({ error: "negado" }, { status: 403 })
    );

    const res = await GET(req(), { params: { dealId: DEAL_ID } });

    expect(res.status).toBe(403);
    expect(mockPrisma.contractTemplate.findMany).not.toHaveBeenCalled();
  });

  it("deal inexistente → 404", async () => {
    mockPrisma.deal.findUnique.mockResolvedValue(null as never);
    expect((await GET(req(), { params: { dealId: DEAL_ID } })).status).toBe(404);
  });
});
