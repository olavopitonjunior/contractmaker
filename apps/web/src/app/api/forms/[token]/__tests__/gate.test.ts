import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../route";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

const mockAuth = vi.mocked(auth);
const mockPrisma = vi.mocked(prisma);

/**
 * Regressão do vazamento de PII: `GET /api/forms/[token]` devolvia o dataJson
 * inteiro (CPF, RG, nome da mãe, dados bancários de todas as partes) pra
 * qualquer um com o link, para sempre — inclusive depois do form enviado.
 */
const PII = {
  vendedores: [{ nome: "Fulano", cpf: "148.109.698-27", nome_mae: "Ciclana" }],
};

function formRow(over: Record<string, unknown> = {}) {
  return {
    id: "form1",
    token: "tok1",
    title: "Negócio",
    schemaType: "compra_venda_v1",
    orgId: "org1",
    dataJson: PII,
    status: "rascunho",
    completedAt: null,
    reopenedAt: null,
    lockedAt: null,
    updatedAt: new Date("2026-07-16T00:00:00Z"),
    ...over,
  };
}

function req() {
  return new NextRequest("http://localhost/api/forms/tok1");
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(null as never);
});

describe("GET /api/forms/[token] — gate de form enviado", () => {
  it("form em rascunho segue público (é o fluxo do cliente preenchendo)", async () => {
    mockPrisma.salesForm.findUnique.mockResolvedValue(formRow() as never);
    const res = await GET(req(), { params: { token: "tok1" } });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ dataJson: PII });
  });

  it("não deixa PII em cache de CDN", async () => {
    mockPrisma.salesForm.findUnique.mockResolvedValue(formRow() as never);
    const res = await GET(req(), { params: { token: "tok1" } });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("form enviado (status completo) nega anônimo e NÃO devolve dataJson", async () => {
    mockPrisma.salesForm.findUnique.mockResolvedValue(
      formRow({ status: "completo", completedAt: new Date("2026-07-16") }) as never
    );
    const res = await GET(req(), { params: { token: "tok1" } });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.reason).toBe("form_closed");
    expect(JSON.stringify(body)).not.toContain("148.109.698-27");
  });

  it("form 'vinculado' também fecha — é o status de todo deal vindo de import/proposta", async () => {
    // Gatear por `status === "completo"` deixaria 100% desses forms abertos:
    // eles nascem "vinculado" e nunca transicionam pra "completo".
    mockPrisma.salesForm.findUnique.mockResolvedValue(
      formRow({ status: "vinculado", completedAt: new Date("2026-07-16") }) as never
    );
    const res = await GET(req(), { params: { token: "tok1" } });
    expect(res.status).toBe(403);
  });

  it("form enviado libera membro da org", async () => {
    mockPrisma.salesForm.findUnique.mockResolvedValue(
      formRow({ status: "completo", completedAt: new Date("2026-07-16") }) as never
    );
    mockAuth.mockResolvedValue({ user: { id: "user1" } } as never);
    mockPrisma.orgMembership.findFirst.mockResolvedValue({ id: "m1" } as never);

    const res = await GET(req(), { params: { token: "tok1" } });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ dataJson: PII });
  });

  it("form enviado nega usuário logado de OUTRA org", async () => {
    mockPrisma.salesForm.findUnique.mockResolvedValue(
      formRow({ status: "completo", completedAt: new Date("2026-07-16") }) as never
    );
    mockAuth.mockResolvedValue({ user: { id: "intruso" } } as never);
    // Sem membership na org do form.
    mockPrisma.orgMembership.findFirst.mockResolvedValue(null as never);

    const res = await GET(req(), { params: { token: "tok1" } });
    expect(res.status).toBe(403);
  });

  it("form reaberto pela org volta a atender o cliente anônimo", async () => {
    mockPrisma.salesForm.findUnique.mockResolvedValue(
      formRow({
        status: "rascunho",
        completedAt: new Date("2026-07-01"),
        reopenedAt: new Date("2026-07-16"),
      }) as never
    );
    const res = await GET(req(), { params: { token: "tok1" } });
    expect(res.status).toBe(200);
  });

  it("form inexistente é 404", async () => {
    mockPrisma.salesForm.findUnique.mockResolvedValue(null as never);
    const res = await GET(req(), { params: { token: "nope" } });
    expect(res.status).toBe(404);
  });
});
