import { describe, it, expect, vi, beforeEach } from "vitest";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

/**
 * `map-field` e `doc-edit` escrevem no MESMO lugar, pelo mesmo `applyDocEdits`.
 * Os casos aqui guardam o que essa rota tinha de próprio — e o gate de modelo
 * ativo, que existia só na irmã: codificar o invariante em um caminho e deixar
 * o outro aberto transforma a regra em decoração.
 *
 * A rota também declarava sucesso sem conferir nada (enviava o replaceAllText e
 * respondia `ok`); agora o resultado vem do aplicador, e um `status` que não é
 * `applied` tem que virar erro para o operador, não silêncio.
 */
const applyDocEditsMock = vi.fn();
vi.mock("@/lib/templates/doc-edit", () => ({
  applyDocEdits: (...a: unknown[]) => applyDocEditsMock(...a),
}));

const auditMock = vi.fn();
vi.mock("@/lib/security/audit", () => ({
  audit: (...a: unknown[]) => auditMock(...a),
  extractAuditContextFromRequest: (_r: unknown, orgId: string, userId: string) => ({ orgId, userId }),
}));

import { POST } from "../[id]/map-field/route";

const authMock = auth as unknown as ReturnType<typeof vi.fn>;
const getUserOrgMock = getUserOrg as unknown as ReturnType<typeof vi.fn>;
const templateFindFirst = vi.fn();
const membershipFindFirst = vi.fn();
Object.assign(prisma.contractTemplate, { findFirst: templateFindFirst });
Object.assign(prisma.orgMembership, { findFirst: membershipFindFirst });

const params = { params: { id: "tpl1" } };
const call = (body: unknown) =>
  POST(
    new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) }) as never,
    params
  );

const CORPO = { token: "locadores_qualificacao", phrase: "João da Silva, brasileiro" };

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: "u1" } });
  getUserOrgMock.mockResolvedValue({ id: "org1" });
  membershipFindFirst.mockResolvedValue({ role: "admin" });
  templateFindFirst.mockResolvedValue({
    googleTemplateDocId: "doc1",
    modalidade: "locacao",
    engine: "google_docs",
    status: "draft",
  });
  applyDocEditsMock.mockResolvedValue({
    results: [{ op: "map-field", status: "applied", target: CORPO.phrase }],
    finalText: "texto",
    appliedAt: "2026-09-03T12:00:00.000Z",
  });
});

describe("POST /api/templates/[id]/map-field", () => {
  it("aplica e audita com a frase MASCARADA", async () => {
    const res = await call({ token: "locadores_qualificacao", phrase: "João, CPF 529.982.247-25" });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(auditMock.mock.calls[0][1].action).toBe("TEMPLATE_FIELD_MAPPED");
    expect(JSON.stringify(auditMock.mock.calls[0][1].metadata)).not.toContain("529.982.247-25");
  });

  it("409 em modelo ATIVO — mesma trava do doc-edit, mesma mensagem", async () => {
    templateFindFirst.mockResolvedValue({
      googleTemplateDocId: "doc1",
      modalidade: "locacao",
      engine: "google_docs",
      status: "active",
    });
    const res = await call(CORPO);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("TEMPLATE_ACTIVE");
    expect(applyDocEditsMock).not.toHaveBeenCalled();
  });

  it("trecho ambíguo devolve 422 com a frase que o operador entende, não 'ok'", async () => {
    applyDocEditsMock.mockResolvedValue({
      results: [{ op: "map-field", status: "skipped", reason: "ambiguous" }],
      finalText: "texto",
      appliedAt: "2026-09-03T12:00:00.000Z",
    });
    const res = await call(CORPO);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("mais de uma vez");
    // Sucesso não conferido é o defeito que esta rota tinha: não pode auditar.
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("releitura indisponível devolve 502, não sucesso", async () => {
    applyDocEditsMock.mockResolvedValue({
      results: [{ op: "map-field", status: "failed", reason: "verify-unavailable" }],
      finalText: null,
      appliedAt: "2026-09-03T12:00:00.000Z",
    });
    expect((await call(CORPO)).status).toBe(502);
  });

  it("401 sem sessão e 403 para member", async () => {
    authMock.mockResolvedValue(null);
    expect((await call(CORPO)).status).toBe(401);
    authMock.mockResolvedValue({ user: { id: "u1" } });
    membershipFindFirst.mockResolvedValue({ role: "member" });
    expect((await call(CORPO)).status).toBe(403);
    expect(applyDocEditsMock).not.toHaveBeenCalled();
  });

  it("404 cross-org, com o filtro na query", async () => {
    templateFindFirst.mockResolvedValue(null);
    expect((await call(CORPO)).status).toBe(404);
    expect(templateFindFirst.mock.calls[0][0].where).toEqual({ id: "tpl1", orgId: "org1" });
  });
});
