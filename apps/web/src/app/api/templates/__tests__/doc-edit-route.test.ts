import { describe, it, expect, vi, beforeEach } from "vitest";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

/**
 * A rota escreve no texto contratual do tenant. O que estes casos guardam é o
 * perímetro: quem pode chamar, o que o corpo aceita, e o que NÃO pode ser
 * editado — mais a linha de auditoria, que é o único lugar onde fica registrado
 * QUEM pediu a alteração de uma cláusula (o histórico do Drive não diz).
 */
vi.mock("@/lib/google/client", () => ({ isGoogleDocsConfigured: () => true }));

const applyDocEditsMock = vi.fn();
vi.mock("@/lib/templates/doc-edit", () => ({
  applyDocEdits: (...a: unknown[]) => applyDocEditsMock(...a),
}));

const validateMock = vi.fn();
vi.mock("@/lib/templates/validate-gdoc", () => ({
  validateGoogleDocTemplate: (...a: unknown[]) => validateMock(...a),
}));

const auditMock = vi.fn();
vi.mock("@/lib/security/audit", () => ({
  audit: (...a: unknown[]) => auditMock(...a),
  extractAuditContextFromRequest: (_r: unknown, orgId: string, userId: string) => ({ orgId, userId }),
}));

import { POST } from "../[id]/doc-edit/route";

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

const OP_VALIDA = {
  op: "remove-leftover" as const,
  phrase: ", CRECI 12345-F",
};

function template(over: Record<string, unknown> = {}) {
  return {
    id: "tpl1",
    orgId: "org1",
    engine: "google_docs",
    googleTemplateDocId: "doc1",
    modalidade: "locacao",
    status: "draft",
    handlebarsSource: "",
    sourceHash: null,
    draftReport: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: "u1" } });
  getUserOrgMock.mockResolvedValue({ id: "org1" });
  membershipFindFirst.mockResolvedValue({ role: "owner" });
  templateFindFirst.mockResolvedValue(template());
  applyDocEditsMock.mockResolvedValue({
    results: [{ op: "remove-leftover", status: "applied", target: ", CRECI 12345-F" }],
    finalText: "texto final",
    appliedAt: "2026-09-03T12:00:00.000Z",
  });
  validateMock.mockResolvedValue({ found: [], unknown: [], semantic: { findings: [] } });
});

describe("POST /api/templates/[id]/doc-edit — perímetro", () => {
  it("401 sem sessão", async () => {
    authMock.mockResolvedValue(null);
    expect((await call({ ops: [OP_VALIDA] })).status).toBe(401);
    expect(applyDocEditsMock).not.toHaveBeenCalled();
  });

  it("403 para member (só owner/admin edita o texto do modelo)", async () => {
    membershipFindFirst.mockResolvedValue({ role: "member" });
    expect((await call({ ops: [OP_VALIDA] })).status).toBe(403);
    expect(applyDocEditsMock).not.toHaveBeenCalled();
  });

  it("404 para template de outro tenant — mesmo 404 do inexistente", async () => {
    templateFindFirst.mockResolvedValue(null);
    expect((await call({ ops: [OP_VALIDA] })).status).toBe(404);
    // O filtro vai NA QUERY: nada confirma a existência do template alheio.
    expect(templateFindFirst.mock.calls[0][0].where).toEqual({ id: "tpl1", orgId: "org1" });
  });

  it("409 em modelo ATIVO: contrato já gerado não pode ter o modelo mudando debaixo", async () => {
    templateFindFirst.mockResolvedValue(template({ status: "active" }));
    const res = await call({ ops: [OP_VALIDA] });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("TEMPLATE_ACTIVE");
    expect(applyDocEditsMock).not.toHaveBeenCalled();
  });

  it("400 com corpo inválido, sem tocar no documento", async () => {
    for (const body of [
      {},
      { ops: [] },
      { ops: [{ op: "inventada", phrase: "x" }] },
      { ops: [{ op: "rekey", phrase: "abc" }] }, // faltam os tokens
      { ops: Array.from({ length: 21 }, () => OP_VALIDA) }, // acima do teto
    ]) {
      expect((await call(body)).status).toBe(400);
    }
    expect(applyDocEditsMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/templates/[id]/doc-edit — efeitos", () => {
  it("com `ops`: aplica, audita com a frase MASCARADA e revalida no mesmo passo", async () => {
    const res = await call({ ops: [{ op: "remove-leftover", phrase: ", CPF 529.982.247-25" }] });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.validation).toBeTruthy();

    const meta = auditMock.mock.calls[0][1].metadata;
    expect(auditMock.mock.calls[0][1].action).toBe("TEMPLATE_DOC_EDIT");
    // A frase vem do contrato-fonte: nunca crua no log.
    expect(JSON.stringify(meta)).not.toContain("529.982.247-25");
  });

  it("com `findingId`: a frase é a que o SERVIDOR produziu, não uma do cliente", async () => {
    const FRASE = ", CRECI 12345-F";
    validateMock.mockResolvedValue({
      found: [],
      unknown: [],
      semantic: {
        findings: [
          {
            id: "leftover-identifier:3:corretagem_qualificacao",
            suggestedFix: { op: "remove-leftover", phrase: FRASE },
          },
        ],
      },
    });

    const res = await call({ findingId: "leftover-identifier:3:corretagem_qualificacao" });
    expect(res.status).toBe(200);

    // A operação aplicada foi montada a partir do achado recalculado.
    expect(applyDocEditsMock.mock.calls[0][0].ops).toEqual([
      { op: "remove-leftover", phrase: FRASE },
    ]);
    expect(auditMock.mock.calls[0][1].metadata.findingId).toBe(
      "leftover-identifier:3:corretagem_qualificacao"
    );
  });

  it("achado que não existe mais: 409 em vez de editar às cegas", async () => {
    const res = await call({ findingId: "wrong-entity:9:corretagem_qualificacao" });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("FINDING_STALE");
    expect(applyDocEditsMock).not.toHaveBeenCalled();
  });

  it("achado sem conserto automático: 422, sem inventar edição", async () => {
    validateMock.mockResolvedValue({
      found: [],
      unknown: [],
      semantic: {
        findings: [{ id: "org-literal:2:imobiliaria_qualificacao", suggestedFix: { op: "manual" } }],
      },
    });
    const res = await call({ findingId: "org-literal:2:imobiliaria_qualificacao" });
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("FINDING_MANUAL");
    expect(applyDocEditsMock).not.toHaveBeenCalled();
  });

  it("nada aplicado → ok:false, e o audit registra FAILURE em vez de silenciar", async () => {
    applyDocEditsMock.mockResolvedValue({
      results: [{ op: "remove-leftover", status: "skipped", reason: "ambiguous" }],
      finalText: "texto",
      appliedAt: "2026-09-03T12:00:00.000Z",
    });
    const body = await (await call({ ops: [OP_VALIDA] })).json();
    expect(body.ok).toBe(false);
    expect(body.results[0].reason).toBe("ambiguous");
    expect(auditMock.mock.calls[0][1].result).toBe("FAILURE");
  });

  it("revalidação que falha NÃO desfaz a edição — devolve validation null", async () => {
    validateMock.mockRejectedValue(new Error("invalid_grant"));
    const res = await call({ ops: [OP_VALIDA] });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.validation).toBeNull();
  });
});
