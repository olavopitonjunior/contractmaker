import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/lib/proposals/route-helpers", () => ({
  loadScopedProposal: vi.fn(),
}));
vi.mock("@/lib/proposals/template-select", () => ({
  selectPropostaTemplate: vi.fn(),
}));

import { POST } from "../route";
import { loadScopedProposal } from "@/lib/proposals/route-helpers";
import { selectPropostaTemplate } from "@/lib/proposals/template-select";
import { prisma } from "@/lib/db/prisma";

const mockLoad = vi.mocked(loadScopedProposal);
const mockSelect = vi.mocked(selectPropostaTemplate);
const mockPrisma = vi.mocked(prisma);

const req = () =>
  new NextRequest("http://localhost/api/proposals/p1/preview", { method: "POST" });

const proposal = (over: Record<string, unknown> = {}) =>
  ({
    id: "proposal-000abc12",
    orgId: "org-1",
    status: "rascunho",
    schemaType: "locacao_residencial_v1",
    templateId: null,
    comissaoIncluida: false,
    dataJson: { locatarios: [{ nome: "Maria" }] },
    ...over,
  }) as never;

function ok(over: Record<string, unknown> = {}) {
  mockLoad.mockResolvedValue({
    auth: { org: { id: "org-1" }, actor: { effectiveUserId: "u1" } },
    eff: {},
    proposal: proposal(over),
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/proposals/[id]/preview", () => {
  it("propaga o 404 do escopo (proposta de outra org / sem acesso)", async () => {
    mockLoad.mockResolvedValue({
      fail: NextResponse.json({ error: "Não encontrada" }, { status: 404 }),
    } as never);
    const res = await POST(req(), { params: { id: "p1" } });
    expect(res.status).toBe(404);
    // Nem tentou renderizar.
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("409 depois do envio — quem manda ali é o snapshot congelado", async () => {
    for (const status of ["enviada", "visualizada", "completa", "convertida", "cancelada"]) {
      ok({ status });
      const res = await POST(req(), { params: { id: "p1" } });
      expect(res.status, status).toBe(409);
    }
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("200 nos três status editáveis, com o template escolhido pelo dataJson", async () => {
    mockSelect.mockResolvedValue({
      template: { handlebarsSource: "<p>doc</p>", name: "Proposta Ativa" },
    } as never);
    for (const status of ["rascunho", "aguardando_aprovacao", "falha_envio"]) {
      ok({ status });
      const res = await POST(req(), { params: { id: "p1" } });
      expect(res.status, status).toBe(200);
      const body = await res.json();
      expect(body.templateName).toBe("Proposta Ativa");
      expect(typeof body.html).toBe("string");
    }
    // A variante é escolhida com o MESMO dataJson do envio.
    expect(mockSelect).toHaveBeenCalledWith("org-1", "locacao_residencial_v1", {
      locatarios: [{ nome: "Maria" }],
    });
  });

  it("higieniza o HTML renderizado antes de devolver", async () => {
    // O mock global de renderContratoHTML devolve `<rendered>{json do ctx}</rendered>`
    // — um valor com <script> no dataJson passa pelo Handlebars (noEscape) e
    // precisa ser removido aqui.
    mockSelect.mockResolvedValue({
      template: { handlebarsSource: "x", name: "T" },
    } as never);
    ok({ dataJson: { locatarios: [{ nome: "<script>alert(1)</script>" }] } });
    const res = await POST(req(), { params: { id: "p1" } });
    const body = await res.json();
    expect(body.html).not.toMatch(/<script/i);
  });

  it("NÃO grava nada (sentSnapshotHtml é congelado só no envio)", async () => {
    mockSelect.mockResolvedValue({ template: { handlebarsSource: "x", name: "T" } } as never);
    ok();
    await POST(req(), { params: { id: "p1" } });
    expect(mockPrisma.proposal.update).not.toHaveBeenCalled();
  });

  it("templateId fixo na proposta tem prioridade sobre a seleção", async () => {
    mockPrisma.contractTemplate.findUnique = vi
      .fn()
      .mockResolvedValue({ handlebarsSource: "<p>fixo</p>", name: "Fixo" }) as never;
    ok({ templateId: "tpl-1" });
    const res = await POST(req(), { params: { id: "p1" } });
    expect(res.status).toBe(200);
    expect((await res.json()).templateName).toBe("Fixo");
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("sem modelo ativo → 200 com html null e motivo acionável", async () => {
    mockSelect.mockResolvedValue(null as never);
    ok();
    const res = await POST(req(), { params: { id: "p1" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.html).toBeNull();
    expect(body.reason).toBe("no_template");
  });
});
