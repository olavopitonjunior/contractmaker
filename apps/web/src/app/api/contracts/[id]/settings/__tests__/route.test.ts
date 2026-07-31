import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAuth } from "@/lib/auth/context";
import {
  DEFAULT_CONTRACT_SETTINGS,
  DEFAULT_LOCACAO_SETTINGS,
} from "@/lib/contracts/default-config";

// requireAuth (context) não é mockado no setup global — mockamos aqui.
vi.mock("@/lib/auth/context", () => ({ requireAuth: vi.fn() }));
// O sync com o Google Doc é I/O externo; aqui interessa o que é gravado.
vi.mock("@/lib/contracts/settings-doc-sync", () => ({
  syncRenderedHtmlDiffToDoc: vi.fn().mockResolvedValue({ attempted: 0, applied: 0, failed: [] }),
}));
vi.mock("@/lib/security/audit", () => ({
  audit: vi.fn().mockResolvedValue(undefined),
  extractAuditContextFromRequest: vi.fn(() => ({})),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const p = prisma as any;
const mockRequireAuth = vi.mocked(requireAuth);

let PATCH: typeof import("../route").PATCH;

/** Contrato de LOCAÇÃO (pipeline kind) sem Google Doc — o patch só grava dados. */
function locacaoContract() {
  return {
    id: "c1",
    dealId: "d1",
    kind: "contract",
    status: "rascunho",
    dataJson: {},
    googleDocId: null,
    templateId: null,
    template: null,
    deal: { dataJson: {}, form: null, pipeline: { kind: "locacao" } },
  };
}

function vendaContract() {
  return { ...locacaoContract(), deal: { dataJson: {}, form: null, pipeline: { kind: "venda" } } };
}

beforeEach(async () => {
  vi.clearAllMocks();
  ({ PATCH } = await import("../route"));
  mockRequireAuth.mockResolvedValue({
    ok: true,
    ctx: { userId: "u1", orgId: "org-1", via: "session" },
  } as never);
  // Mutação IN PLACE: o `$transaction` do setup global passa a mesma instância
  // de mock como `tx`, então trocar o objeto `p.contract` deixaria o `tx` com o
  // mock antigo e as asserções sobre `update` não veriam nada.
  p.contract.findFirst = vi.fn().mockResolvedValue(locacaoContract());
  // guardContractScope (escopo do gerente, veio da staging) faz um findUnique
  // próprio — sem manager e com a org do ctx, o guard libera.
  p.contract.findUnique = vi.fn().mockResolvedValue({
    deal: { userId: "u1", managerUserId: null, pipeline: { orgId: "org-1" } },
  });
  p.contract.update = vi.fn().mockResolvedValue({});
  p.envelope.findFirst.mockResolvedValue(null);
  p.deal.update.mockResolvedValue({});
  p.contractChangeLog.create.mockResolvedValue({});
});

function req(body: unknown) {
  return new NextRequest("http://localhost/api/contracts/c1/settings", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/contracts/[id]/settings — família do contrato", () => {
  it("400 nomeando os campos quando chega payload de VENDA num contrato de locação", async () => {
    const res = await PATCH(req(DEFAULT_CONTRACT_SETTINGS), { params: { id: "c1" } });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.fields).toContain("desistencia");
    expect(body.fields).toContain("config.multa_penal_moratoria");
    // Nada foi gravado.
    expect(p.contract.update).not.toHaveBeenCalled();
  });

  it("400 quando chega payload de LOCAÇÃO num contrato de venda", async () => {
    p.contract.findFirst.mockResolvedValue(vendaContract());
    const res = await PATCH(req(DEFAULT_LOCACAO_SETTINGS), { params: { id: "c1" } });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.fields).toContain("config.multa_atraso_percent");
    expect(p.contract.update).not.toHaveBeenCalled();
  });

  it("contrato de administração é família locação, mesmo com pipeline de venda", async () => {
    p.contract.findFirst.mockResolvedValue({
      ...vendaContract(),
      kind: "administracao",
    });
    const res = await PATCH(req(DEFAULT_CONTRACT_SETTINGS), { params: { id: "c1" } });
    expect(res.status).toBe(400);
  });

  it("payload de locação num contrato de locação grava as pontes do enrich", async () => {
    const res = await PATCH(
      req({
        foro: "Santos/SP",
        assinatura: { cidade: "Santos", uf: "SP", data: "" },
        config: {
          multa_atraso_percent: 8,
          juros_mensais_atraso: 1,
          multa_rescisoria_meses: 3,
          honorarios_advocaticios_percent: 10,
        },
      }),
      { params: { id: "c1" } }
    );
    expect(res.status).toBe(200);

    const data = p.contract.update.mock.calls[0][0].data.dataJson;
    expect(data.foro).toBe("Santos/SP");
    expect(data.config.foro_texto).toBe("Santos/SP");
    expect(data.config.municipio_imovel).toBe("Santos/SP");
    expect(data.config.multa_atraso_percent).toBe(8);
    // O bloco de desistência (venda) não é inventado em locação.
    expect(data.desistencia).toBeUndefined();
  });

  it("payload de venda num contrato de venda segue gravando o shape de venda", async () => {
    p.contract.findFirst.mockResolvedValue(vendaContract());
    const res = await PATCH(req(DEFAULT_CONTRACT_SETTINGS), { params: { id: "c1" } });
    expect(res.status).toBe(200);

    const data = p.contract.update.mock.calls[0][0].data.dataJson;
    expect(data.foro).toBe("arbitragem");
    expect(data.config.desistencia_permite).toBe(false);
    expect(data.config.multa_penal_moratoria).toBe(2);
  });

  it("400 quando o payload não bate com o schema da própria família", async () => {
    const res = await PATCH(
      req({ foro: "Santos/SP", assinatura: { cidade: "", uf: "", data: "" }, config: {} }),
      { params: { id: "c1" } }
    );
    expect(res.status).toBe(400);
    expect((await res.json()).issues).toBeTruthy();
  });

  it("404 quando o contrato não é da org (cross-org)", async () => {
    p.contract.findFirst.mockResolvedValue(null);
    const res = await PATCH(req(DEFAULT_LOCACAO_SETTINGS), { params: { id: "c1" } });
    expect(res.status).toBe(404);
  });

  it("409 em contrato aprovado — antes de qualquer validação de payload", async () => {
    p.contract.findFirst.mockResolvedValue({ ...locacaoContract(), status: "aprovado" });
    const res = await PATCH(req(DEFAULT_LOCACAO_SETTINGS), { params: { id: "c1" } });
    expect(res.status).toBe(409);
  });
});
