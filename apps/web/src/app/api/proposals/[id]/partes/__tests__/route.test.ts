import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/proposals/route-helpers", () => ({
  loadScopedProposal: vi.fn(),
  proposalFeatureGuard: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/security/rbac/check", () => ({
  can: vi.fn().mockReturnValue(true),
}));

import { PATCH } from "../route";
import { loadScopedProposal } from "@/lib/proposals/route-helpers";
import { can } from "@/lib/security/rbac/check";
import { prisma } from "@/lib/db/prisma";

const mockLoad = vi.mocked(loadScopedProposal);
const mockCan = vi.mocked(can);
const updateMany = prisma.proposal.updateMany as unknown as ReturnType<typeof vi.fn>;
const eventCreate = prisma.proposalEvent.create as unknown as ReturnType<typeof vi.fn>;

const DATA = {
  locatarios: [{ nome: "Maria", cpf: "52998224725" }],
  garantia: { tipo: "fiador", fiador: { nome: "F" } },
  comissao: { percentual: 5 },
};

function load(over: Partial<{ status: string; kind: string; dataJson: unknown }> = {}) {
  mockLoad.mockResolvedValue({
    auth: { org: { id: "org-1" }, actor: { effectiveUserId: "u1" } },
    eff: {},
    proposal: { id: "p1", kind: "locacao", status: "enviada", dataJson: DATA, ...over },
  } as never);
}
const req = (body: unknown) =>
  new NextRequest("http://localhost/api/proposals/p1/partes", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
const params = { params: { id: "p1" } };

beforeEach(() => {
  vi.clearAllMocks();
  mockCan.mockReturnValue(true);
  updateMany.mockResolvedValue({ count: 1 });
  eventCreate.mockResolvedValue({});
  load();
});

describe("PATCH /api/proposals/[id]/partes — o que RECUSA", () => {
  it("sem CREATE nem SEND → 403", async () => {
    mockCan.mockReturnValue(false);
    expect((await PATCH(req({ target: { kind: "locatario", index: 0 }, fields: { rg: "1" } }), params)).status).toBe(403);
  });

  it("proposta terminal → 409 (o corte é TERMINAL, não EDITABLE: enviada passa)", async () => {
    load({ status: "convertida" });
    expect((await PATCH(req({ target: { kind: "locatario", index: 0 }, fields: { rg: "1" } }), params)).status).toBe(409);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("alvo de outra esteira / chave fora da allowlist → 400", async () => {
    expect((await PATCH(req({ target: { kind: "comprador", index: 0 }, fields: { rg: "1" } }), params)).status).toBe(400);
    expect((await PATCH(req({ target: { kind: "locatario", index: 0 }, fields: { comissao: 1 } }), params)).status).toBe(400);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("parte inexistente (locatário 5) → 404; cônjuge de parte inexistente → 404", async () => {
    expect((await PATCH(req({ target: { kind: "locatario", index: 5 }, fields: { rg: "1" } }), params)).status).toBe(404);
    expect((await PATCH(req({ target: { kind: "conjuge_locatario", index: 5 }, fields: { nome: "X" } }), params)).status).toBe(404);
  });

  it("trocar CPF já preenchido → 409 (identidade só quando vazia)", async () => {
    const res = await PATCH(req({ target: { kind: "locatario", index: 0 }, fields: { cpf: "11144477735" } }), params);
    expect(res.status).toBe(409);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("corrida: virou terminal entre o check e a escrita → 409", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    expect((await PATCH(req({ target: { kind: "locatario", index: 0 }, fields: { rg: "1" } }), params)).status).toBe(409);
  });
});

describe("PATCH /partes — o que ACEITA", () => {
  it("grava nascimento/renda no locatário, com guard atômico por status e evento credit_data_updated", async () => {
    const res = await PATCH(
      req({ target: { kind: "locatario", index: 0 }, fields: { data_nascimento: "1990-05-10", renda_mensal: 3500, renda_origem: 11, residir: true } }),
      params
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.path).toBe("locatarios.0");
    expect(body.party).toEqual({ nome: "Maria", cpf: "52998224725", data_nascimento: "1990-05-10", renda_mensal: 3500, renda_origem: 11, residir: true });
    const call = updateMany.mock.calls[0][0];
    expect(call.where.status.notIn).toContain("convertida");
    expect(call.data.dataJson.comissao).toEqual({ percentual: 5 });
    expect(eventCreate.mock.calls[0][0].data.eventName).toBe("credit_data_updated");
  });

  it("cônjuge do fiador nasce sob o fiador; mesmo CPF já gravado não é conflito", async () => {
    const res = await PATCH(
      req({ target: { kind: "conjuge_fiador", index: 0 }, fields: { nome: "Helena", cpf: "11144477735" } }),
      params
    );
    expect(res.status).toBe(200);
    expect((await res.json()).path).toBe("garantia.fiador.conjuge");
    const ok = await PATCH(req({ target: { kind: "locatario", index: 0 }, fields: { cpf: "52998224725", rg: "9" } }), params);
    expect(ok.status).toBe(200);
  });

  it("\"\" apaga o campo", async () => {
    load({ dataJson: { locatarios: [{ nome: "Maria", rg: "9", nome_mae: "Ana" }] } });
    const res = await PATCH(req({ target: { kind: "locatario", index: 0 }, fields: { rg: "" } }), params);
    expect((await res.json()).party).toEqual({ nome: "Maria", nome_mae: "Ana" });
  });
});
