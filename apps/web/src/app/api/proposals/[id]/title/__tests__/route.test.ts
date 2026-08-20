import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/lib/proposals/route-helpers", () => ({
  loadScopedProposal: vi.fn(),
  proposalFeatureGuard: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/security/audit", () => ({
  audit: vi.fn().mockResolvedValue(undefined),
  extractAuditContextFromRequest: vi.fn(() => ({})),
}));

import { PATCH } from "../route";
import { loadScopedProposal } from "@/lib/proposals/route-helpers";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { resolvePermissions, ROLE_PRESETS } from "@/lib/security/rbac/roles";
import { prisma } from "@/lib/db/prisma";

const mockLoad = vi.mocked(loadScopedProposal);
const mockPrisma = vi.mocked(prisma);

function req(title: string) {
  return new NextRequest("http://localhost/api/proposals/p1/title", {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
}

const params = { params: { id: "p1" } };

function scoped(permissions: Record<string, boolean>, status = "enviada") {
  mockLoad.mockResolvedValue({
    auth: { org: { id: "org-1" }, actor: { effectiveUserId: "u1" } },
    eff: { permissions },
    proposal: { id: "p1", orgId: "org-1", status, title: "Antigo", kind: "venda" },
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.proposal.updateMany.mockResolvedValue({ count: 1 } as never);
  mockPrisma.proposalEvent.create.mockResolvedValue({} as never);
});

describe("PATCH /api/proposals/[id]/title — renomear exige permissão de escrita", () => {
  it("papel `viewer` (VIEW_ALL sem CREATE/SEND) → 403", async () => {
    // O caso concreto do bug: `loadScopedProposal` libera quem tem
    // PROPOSAL_VIEW_ALL, e `viewer` é exatamente isso — vê todas as propostas
    // da org e não produz nenhuma. Sem o guard, ele renomeava qualquer proposta
    // em curso, com a UI oferecendo o botão.
    const viewer = resolvePermissions("viewer") as Record<string, boolean>;
    expect(viewer[PERMISSION.PROPOSAL_VIEW_ALL]).toBe(true);
    expect(viewer[PERMISSION.PROPOSAL_CREATE]).toBeFalsy();
    expect(viewer[PERMISSION.PROPOSAL_SEND]).toBeFalsy();

    scoped(viewer);
    const res = await PATCH(req("Novo título"), params);
    expect(res.status).toBe(403);
    expect(mockPrisma.proposal.updateMany).not.toHaveBeenCalled();
  });

  it("NENHUM preset com VIEW_ALL e sem CREATE/SEND renomeia", async () => {
    // Guarda de regressão que não depende do nome do papel: hoje só `viewer`
    // tem esse recorte, mas um preset novo (auditoria, portal) cairia no mesmo
    // buraco em silêncio. O que importa é a forma da permissão, não o rótulo.
    const readOnly = Object.entries(ROLE_PRESETS).filter(([, map]) => {
      const m = map as Record<string, boolean>;
      return m[PERMISSION.PROPOSAL_VIEW_ALL] && !m[PERMISSION.PROPOSAL_CREATE] && !m[PERMISSION.PROPOSAL_SEND];
    });
    expect(readOnly.length).toBeGreaterThan(0); // senão o teste vira vacuidade
    for (const [role, map] of readOnly) {
      scoped(map as Record<string, boolean>);
      const res = await PATCH(req("Novo título"), params);
      expect(res.status, role).toBe(403);
    }
  });

  it("quem pode CRIAR renomeia", async () => {
    scoped({ [PERMISSION.PROPOSAL_CREATE]: true });
    const res = await PATCH(req("Novo título"), params);
    expect(res.status).toBe(200);
    expect(mockPrisma.proposal.updateMany).toHaveBeenCalled();
  });

  it("quem pode ENVIAR renomeia", async () => {
    scoped({ [PERMISSION.PROPOSAL_SEND]: true });
    const res = await PATCH(req("Novo título"), params);
    expect(res.status).toBe(200);
  });

  it("terminal segue 409 mesmo com permissão", async () => {
    scoped({ [PERMISSION.PROPOSAL_CREATE]: true }, "cancelada");
    const res = await PATCH(req("Novo título"), params);
    expect(res.status).toBe(409);
  });

  it("propaga o 404 do escopo", async () => {
    mockLoad.mockResolvedValue({
      fail: NextResponse.json({ error: "Não encontrada" }, { status: 404 }),
    } as never);
    const res = await PATCH(req("Novo título"), params);
    expect(res.status).toBe(404);
  });
});
