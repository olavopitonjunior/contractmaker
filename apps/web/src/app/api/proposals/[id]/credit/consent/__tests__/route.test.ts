import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/proposals/route-helpers", () => ({
  loadScopedProposal: vi.fn(),
  proposalFeatureGuard: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/security/rbac/check", () => ({
  can: vi.fn().mockReturnValue(true),
}));

import { POST, DELETE } from "../route";
import { loadScopedProposal } from "@/lib/proposals/route-helpers";
import { can } from "@/lib/security/rbac/check";
import { prisma } from "@/lib/db/prisma";

const mockLoad = vi.mocked(loadScopedProposal);
const mockCan = vi.mocked(can);
const updateMany = prisma.proposal.updateMany as unknown as ReturnType<typeof vi.fn>;
const eventCreate = prisma.proposalEvent.create as unknown as ReturnType<typeof vi.fn>;

function load(over: Partial<{ status: string; complianceJson: unknown }> = {}) {
  mockLoad.mockResolvedValue({
    auth: { org: { id: "org-1" }, actor: { effectiveUserId: "u1" } },
    eff: {},
    proposal: { id: "p1", kind: "locacao", status: "enviada", complianceJson: null, ...over },
  } as never);
}
const post = (body: unknown) =>
  new NextRequest("http://localhost/api/proposals/p1/credit/consent", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
const del = () => new NextRequest("http://localhost/api/proposals/p1/credit/consent", { method: "DELETE" });
const params = { params: { id: "p1" } };

beforeEach(() => {
  vi.clearAllMocks();
  mockCan.mockReturnValue(true);
  updateMany.mockResolvedValue({ count: 1 });
  eventCreate.mockResolvedValue({});
  load();
});

describe("consentimento LGPD na proposta", () => {
  it("sem permissão → 403; terminal → 409; base legal inválida → 400", async () => {
    mockCan.mockReturnValue(false);
    expect((await POST(post({ baseLegal: "protecao_credito" }), params)).status).toBe(403);
    mockCan.mockReturnValue(true);
    load({ status: "cancelada" });
    expect((await POST(post({ baseLegal: "protecao_credito" }), params)).status).toBe(409);
    load();
    expect((await POST(post({ baseLegal: "outra" }), params)).status).toBe(400);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("POST grava creditConsent canônico com provider fichacerta, preservando o resto do complianceJson", async () => {
    load({ complianceJson: { outraChave: 1 } });
    const res = await POST(post({ baseLegal: "execucao_contrato" }), params);
    expect(res.status).toBe(200);
    const data = updateMany.mock.calls[0][0].data.complianceJson;
    expect(data.outraChave).toBe(1);
    expect(data.creditConsent).toMatchObject({ by: "u1", baseLegal: "execucao_contrato", provider: "fichacerta" });
    expect(typeof data.creditConsent.at).toBe("string");
    expect(eventCreate.mock.calls[0][0].data.eventName).toBe("credit_consent_given");
  });

  it("DELETE apaga a canônica e a legada; sem consentimento é no-op", async () => {
    load({ complianceJson: { serasaConsent: { at: "2026-01-01T00:00:00Z", by: "x", baseLegal: "protecao_credito" }, k: 2 } });
    const res = await DELETE(del(), params);
    expect(res.status).toBe(200);
    expect(updateMany.mock.calls[0][0].data.complianceJson).toEqual({ k: 2 });
    expect(eventCreate.mock.calls[0][0].data.eventName).toBe("credit_consent_revoked");

    vi.clearAllMocks();
    load({ complianceJson: {} });
    expect((await DELETE(del(), params)).status).toBe(200);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("corrida: proposta virou terminal entre o check e a escrita → POST e DELETE respondem 409, não 'ok'", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    expect((await POST(post({ baseLegal: "protecao_credito" }), params)).status).toBe(409);
    load({ complianceJson: { creditConsent: { at: "2026-01-01T00:00:00Z", by: "x", baseLegal: "protecao_credito" } } });
    expect((await DELETE(del(), params)).status).toBe(409);
    expect(eventCreate).not.toHaveBeenCalled();
  });
});
