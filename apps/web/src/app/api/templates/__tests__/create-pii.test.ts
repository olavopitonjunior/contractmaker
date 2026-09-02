import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../route";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { createMockSession, createMockOrg } from "@/__tests__/helpers";

/**
 * A criação nasce ativa e não passava pelo gate de PII do PATCH. Source
 * handlebars com dado pessoal literal nasce RASCUNHO, com o relatório — e a
 * ativação passa pela trava.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const p = prisma as any;

function req(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/templates", {
    method: "POST",
    body: JSON.stringify({ name: "Modelo", modalidade: "locacao", ...body }),
  });
}

describe("POST /api/templates — gate de PII na criação", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue(createMockSession() as never);
    vi.mocked(getUserOrg).mockResolvedValue(createMockOrg() as never);
    p.contractTemplate.findFirst = vi.fn().mockResolvedValue(null);
    p.contractTemplate.findMany = vi.fn().mockResolvedValue([]);
    p.contractTemplate.updateMany = vi.fn().mockResolvedValue({ count: 0 });
    p.contractTemplate.create = vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: "t-new", ...args.data }));
  });

  it("source com CPF nasce draft e com draftReport.pii bloqueado", async () => {
    const res = await POST(req({ handlebarsSource: "<p>Locatário: CPF nº 529.982.247-25</p>" }));
    expect(res.status).toBe(201);
    const data = p.contractTemplate.create.mock.calls[0][0].data;
    expect(data.status).toBe("draft");
    expect(data.draftReport.pii.blocked).toBe(true);
    expect(data.draftReport.pii.kinds).toEqual(["cpf"]);
  });

  it("rascunho com PII marcado como principal NÃO rebaixa o principal ativo da modalidade", async () => {
    const res = await POST(
      req({ handlebarsSource: "<p>CPF nº 529.982.247-25</p>", isDefault: true })
    );
    expect(res.status).toBe(201);
    expect(p.contractTemplate.updateMany).not.toHaveBeenCalled();
    expect(p.contractTemplate.create.mock.calls[0][0].data.isDefault).toBe(false);
  });

  it("source limpo (só chaves e timbre) nasce ativo como antes", async () => {
    const res = await POST(req({ handlebarsSource: "<p>{{locatarios_qualificacao}} — CNPJ 17.641.514/0001-29</p>" }));
    expect(res.status).toBe(201);
    const data = p.contractTemplate.create.mock.calls[0][0].data;
    expect(data.status).toBe("active");
    expect(data.draftReport).toBeUndefined();
  });
});
