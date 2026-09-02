import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";

/**
 * PIPELINE POR KIND na conversão de lead (#514).
 *
 * A rota resolvia o funil com `prisma.pipeline.findFirst({ where: { orgId } })`,
 * sem `kind` — o footgun que o próprio `getPipelineByKind` documenta. Medido em
 * produção em 2026-09-02: as 5 organizações que têm pipeline têm venda E
 * locação, então o `findFirst` era ambíguo em TODAS elas. A conversão podia
 * criar o negócio no funil de LOCAÇÃO logo depois de cobrar `deal.create`
 * ("criar negócio de venda").
 *
 * O mock abaixo é o que dá poder ao teste: ele DEVOLVE O FUNIL DE LOCAÇÃO
 * quando a consulta chega sem `kind`. Com o código antigo o teste falha; só
 * passa porque a consulta agora filtra.
 */

vi.mock("@/lib/auth/impersonation", () => ({
  getEffectiveUserId: vi.fn(async (id: string) => id),
}));

vi.mock("@vercel/functions", () => ({ waitUntil: vi.fn() }));

vi.mock("@/lib/newton/group-match", () => ({
  matchDealGroup: vi.fn(async () => undefined),
}));

vi.mock("@/lib/security/audit", () => ({
  audit: vi.fn(async () => undefined),
  extractAuditContextFromRequest: vi.fn(() => ({})),
}));

vi.mock("@/lib/deals/manager", () => ({
  resolveManagerForCreate: vi.fn(async () => ({
    ok: true,
    managerUserId: null,
  })),
}));

const requireApiAuthMock = vi.fn();
vi.mock("@/lib/api/require-auth", () => ({
  requireApiAuth: (...a: unknown[]) => requireApiAuthMock(...(a as [])),
  isAuthFailure: (v: unknown) => v === null,
  authFailureResponse: () =>
    new Response(JSON.stringify({ error: "unauth" }), { status: 401 }),
}));

import { POST } from "../route";

const ATOR = "user-ator";
const ORG = "org-1";

const pipelineFind = prisma.pipeline
  .findFirst as unknown as ReturnType<typeof vi.fn>;
const leadFind = prisma.lead.findUnique as unknown as ReturnType<typeof vi.fn>;
const dealCreate = prisma.deal.create as unknown as ReturnType<typeof vi.fn>;
const formCreate = prisma.salesForm
  .create as unknown as ReturnType<typeof vi.fn>;
const leadUpdate = prisma.lead.update as unknown as ReturnType<typeof vi.fn>;
const membershipFind = prisma.orgMembership
  .findUnique as unknown as ReturnType<typeof vi.fn>;
const managerSettingsFind = prisma.orgManagerSettings
  .findUnique as unknown as ReturnType<typeof vi.fn>;

const FUNIL_VENDA = {
  id: "pipe-venda",
  orgId: ORG,
  kind: "venda",
  stages: [{ id: "stage-venda", position: 0 }],
};
const FUNIL_LOCACAO = {
  id: "pipe-locacao",
  orgId: ORG,
  kind: "locacao",
  stages: [{ id: "stage-locacao", position: 0 }],
};

async function converter() {
  const req = new NextRequest(
    "http://localhost/api/leads/lead-1/convert-to-deal",
    {
      method: "POST",
      body: "{}",
      headers: { "content-type": "application/json" },
    }
  );
  return POST(req, { params: { leadId: "lead-1" } });
}

describe("POST /api/leads/[leadId]/convert-to-deal — funil por kind (#514)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireApiAuthMock.mockResolvedValue({
      ident: { via: "session", userId: ATOR, tokenId: null },
      org: { id: ORG },
      actor: { effectiveUserId: ATOR },
    });
    membershipFind.mockResolvedValue({
      userId: ATOR,
      orgId: ORG,
      role: "admin",
      customRole: null,
    });
    managerSettingsFind.mockResolvedValue(null);
    leadFind.mockResolvedValue({
      id: "lead-1",
      orgId: ORG,
      userId: ATOR,
      title: "Lead",
      status: "open",
      convertedDealId: null,
      metadata: {},
    });
    formCreate.mockResolvedValue({ id: "form-1", token: "tok" });
    dealCreate.mockResolvedValue({ id: "deal-1" });
    leadUpdate.mockResolvedValue({});

    // Org com os DOIS funis — o retrato de todas as 5 orgs de produção.
    // Sem `kind` na consulta, devolve o de LOCAÇÃO.
    pipelineFind.mockImplementation(
      async (args: { where?: { kind?: string } }) =>
        args?.where?.kind === "venda" ? FUNIL_VENDA : FUNIL_LOCACAO
    );
  });

  it("cria o negócio no funil de VENDA, não no de locação", async () => {
    const res = await converter();
    expect(res.status).toBe(200);
    expect(dealCreate).toHaveBeenCalledTimes(1);
    const data = dealCreate.mock.calls[0][0].data;
    expect(data.pipelineId).toBe("pipe-venda");
    expect(data.stageId).toBe("stage-venda");
  });

  it("a consulta ao funil declara kind=venda — é o filtro que faltava", async () => {
    await converter();
    expect(pipelineFind).toHaveBeenCalledTimes(1);
    expect(pipelineFind.mock.calls[0][0].where).toMatchObject({
      orgId: ORG,
      kind: "venda",
    });
  });

  it("org sem funil de venda recusa em vez de cair no de locação", async () => {
    pipelineFind.mockImplementation(async (args: { where?: { kind?: string } }) =>
      args?.where?.kind === "venda" ? null : FUNIL_LOCACAO
    );
    const res = await converter();
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "Org sem pipeline default",
    });
    expect(dealCreate).not.toHaveBeenCalled();
  });

  it("viewer continua barrado antes de chegar no funil (gate do #513)", async () => {
    membershipFind.mockResolvedValue({
      userId: ATOR,
      orgId: ORG,
      role: "viewer",
      customRole: null,
    });
    const res = await converter();
    expect(res.status).toBe(403);
    expect(pipelineFind).not.toHaveBeenCalled();
  });
});
