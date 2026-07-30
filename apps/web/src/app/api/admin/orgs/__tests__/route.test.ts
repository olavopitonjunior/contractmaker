/**
 * Criação de tenant (super-admin) — recorte: o seed de templates canônicos
 * respeita os MÓDULOS escolhidos.
 *
 * Antes, `seedCanonicalTemplatesForOrg` era chamado sem escopo e o tenant
 * só-locação nascia com CCV à vista/financiamento, contradizendo as rows de
 * `OrgModule` (enabled=false pra vendas) escritas na MESMA request.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

vi.mock("@/lib/templates/canonical-seed", () => ({
  seedCanonicalTemplatesForOrg: vi
    .fn()
    .mockResolvedValue({ created: [], skipped: [] }),
}));
vi.mock("@/lib/knowledge/seed-clauses", () => ({
  seedAndEmbedDefaultClauses: vi
    .fn()
    .mockResolvedValue({ created: 0, skipped: 0, embed: null }),
}));
vi.mock("@/lib/org/owner-access", () => ({
  sendOwnerAccessEmail: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/org/seed-document-style", () => ({
  seedDefaultDocumentStyle: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/pipelines/seed", () => ({
  seedPipeline: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/security/audit", () => ({
  audit: vi.fn().mockResolvedValue(undefined),
  extractAuditContextFromRequest: vi.fn(() => ({})),
}));
vi.mock("@vercel/functions", () => ({ waitUntil: vi.fn() }));

import { POST } from "../route";
import { seedCanonicalTemplatesForOrg } from "@/lib/templates/canonical-seed";
import { seedPipeline } from "@/lib/pipelines/seed";

type MockFn = ReturnType<typeof vi.fn>;
const authMock = auth as unknown as MockFn;
const seedTemplates = seedCanonicalTemplatesForOrg as unknown as MockFn;
const seedPipelineMock = seedPipeline as unknown as MockFn;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const p = prisma as any;

function req(body: unknown) {
  return new NextRequest("http://localhost/api/admin/orgs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const BASE = {
  name: "Imobiliária Teste",
  subdomain: "teste",
  ownerEmail: "dono@teste.com",
};

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: "u1" } });
  p.platformRole.findUnique = vi
    .fn()
    .mockResolvedValue({ role: "super_admin", scope: [] });
  p.organization.findUnique = vi.fn().mockResolvedValue(null);
  p.organization.create = vi.fn().mockResolvedValue({ id: "org-new" });
  p.user.findUnique = vi.fn().mockResolvedValue(null);
  p.user.create = vi.fn().mockResolvedValue({ id: "owner-1" });
  p.orgMembership.create = vi.fn().mockResolvedValue({});
  p.orgModule.createMany = vi.fn().mockResolvedValue({ count: 2 });
  p.brandingSettings.create = vi.fn().mockResolvedValue({});
  seedTemplates.mockResolvedValue({ created: [], skipped: [] });
});

describe("POST /api/admin/orgs — seed de templates por módulo", () => {
  it("tenant só-locação NÃO ganha a_vista/financiamento/proposta_venda", async () => {
    const res = await POST(req({ ...BASE, modules: ["locacao"] }));

    expect(res.status).toBe(201);
    const only = seedTemplates.mock.calls[0][1].onlyModalidades;
    expect(only).toEqual([
      "locacao",
      "locacao_comercial",
      "administracao_locacao",
      "proposta_locacao_residencial",
      "proposta_locacao_comercial",
    ]);
    expect(only).not.toContain("a_vista");
    expect(only).not.toContain("financiamento");
    expect(only).not.toContain("proposta_venda");
    // Coerente com as outras decisões da mesma request.
    expect(seedPipelineMock).toHaveBeenCalledTimes(1);
    expect(seedPipelineMock.mock.calls[0][1]).toBe("locacao");
    const moduleRows = p.orgModule.createMany.mock.calls[0][0].data;
    expect(moduleRows).toContainEqual(
      expect.objectContaining({ module: "vendas", enabled: false })
    );
  });

  it("tenant só-vendas ganha só as 3 modalidades de venda", async () => {
    await POST(req({ ...BASE, modules: ["vendas"] }));

    expect(seedTemplates.mock.calls[0][1].onlyModalidades).toEqual([
      "a_vista",
      "financiamento",
      "proposta_venda",
    ]);
  });

  it("sem `modules` (default = ambos) semeia as 8 modalidades", async () => {
    await POST(req(BASE));

    expect(seedTemplates.mock.calls[0][1].onlyModalidades).toHaveLength(8);
  });

  it("falha do seed de templates não derruba a criação do tenant", async () => {
    seedTemplates.mockRejectedValueOnce(new Error("boom"));
    const res = await POST(req({ ...BASE, modules: ["vendas"] }));
    expect(res.status).toBe(201);
  });
});
