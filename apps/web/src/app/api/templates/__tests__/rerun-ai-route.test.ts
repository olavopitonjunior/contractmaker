import { describe, it, expect, vi, beforeEach } from "vitest";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

/**
 * "Pedir revisão pela IA" em dois tempos. O que estes casos guardam:
 * - `propose` NUNCA chega ao caminho de escrita (é o ponto do PR);
 * - `apply` passa a lista aceita e o hash ao módulo, e a recusa por Doc
 *   alterado vira 409 — não uma escrita parcial;
 * - o corpo ausente é `propose` (o disparo que escrevia direto deixou de existir);
 * - a linha de auditoria da escrita não carrega trecho de contrato.
 */
const proposeMock = vi.fn();
const applyMock = vi.fn();
vi.mock("@/lib/templates/ai-placeholder-insertion", () => {
  class DocChangedError extends Error {
    readonly code = "DOC_CHANGED";
    constructor() {
      super("O documento mudou.");
      this.name = "DocChangedError";
    }
  }
  return {
    proposePlaceholdersWithAI: (...a: unknown[]) => proposeMock(...a),
    applyAcceptedProposals: (...a: unknown[]) => applyMock(...a),
    DocChangedError,
  };
});

const getDocPlainTextMock = vi.fn();
vi.mock("@/lib/google/docs", () => ({
  getDocPlainText: (...a: unknown[]) => getDocPlainTextMock(...a),
}));

vi.mock("@/lib/templates/pii-gate", () => ({
  auditTemplateText: () => ({ blocked: false, findings: [] }),
  readDraftReport: (raw: unknown) => (raw && typeof raw === "object" ? raw : {}),
}));

const auditMock = vi.fn();
vi.mock("@/lib/security/audit", () => ({
  audit: (...a: unknown[]) => auditMock(...a),
  extractAuditContextFromRequest: (_r: unknown, orgId: string, userId: string) => ({ orgId, userId }),
}));

import { DocChangedError } from "@/lib/templates/ai-placeholder-insertion";
import { POST } from "../[id]/rerun-ai/route";

const authMock = auth as unknown as ReturnType<typeof vi.fn>;
const getUserOrgMock = getUserOrg as unknown as ReturnType<typeof vi.fn>;
const templateFindFirst = vi.fn();
const templateUpdate = vi.fn();
const membershipFindFirst = vi.fn();
Object.assign(prisma.contractTemplate, { findFirst: templateFindFirst, update: templateUpdate });
Object.assign(prisma.orgMembership, { findFirst: membershipFindFirst });

const params = { params: { id: "tpl1" } };
const call = (body?: unknown) =>
  POST(
    new Request("http://localhost/x", {
      method: "POST",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }) as never,
    params
  );

function template(over: Record<string, unknown> = {}) {
  return {
    googleTemplateDocId: "doc1",
    modalidade: "locacao",
    engine: "google_docs",
    status: "draft",
    draftReport: { slots: [{ slot: "garantia", applied: true, token: "clausula_garantia" }] },
    ...over,
  };
}

const PROPOSTA = {
  proposals: [
    {
      id: "aluguel_valor:x",
      token: "aluguel_valor",
      trecho: "R$ 1.000,00",
      kind: "simple",
      multiParagraph: false,
      paragraphIndex: 0,
      before: "Aluguel de R$ 1.000,00.",
      after: "Aluguel de {{aluguel_valor}}.",
      warnings: [],
    },
  ],
  skipped: [],
  docTruncated: false,
  responseTruncated: false,
  responseUnparsed: false,
  ranAt: "2026-09-04T22:00:00.000Z",
  docTextHash: "h1",
};

const RELATORIO = {
  inserted: [{ token: "aluguel_valor", trecho: "R$ ***" }],
  skippedAmbiguous: [],
  notMapped: [],
  missingRequired: [],
  ranAt: "2026-09-04T22:01:00.000Z",
  docTruncated: false,
  responseTruncated: false,
  responseUnparsed: false,
  unconfirmed: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: "u1" } });
  getUserOrgMock.mockResolvedValue({ id: "org1" });
  membershipFindFirst.mockResolvedValue({ role: "owner" });
  templateFindFirst.mockResolvedValue(template());
  templateUpdate.mockResolvedValue({});
  proposeMock.mockResolvedValue(PROPOSTA);
  applyMock.mockResolvedValue(RELATORIO);
  getDocPlainTextMock.mockResolvedValue("Aluguel de {{aluguel_valor}}.");
});

describe("POST /api/templates/[id]/rerun-ai — perímetro", () => {
  it("401 sem sessão; nada é chamado", async () => {
    authMock.mockResolvedValue(null);
    expect((await call({ action: "propose" })).status).toBe(401);
    expect(proposeMock).not.toHaveBeenCalled();
    expect(applyMock).not.toHaveBeenCalled();
  });

  it("403 para member", async () => {
    membershipFindFirst.mockResolvedValue({ role: "member" });
    expect((await call({ action: "propose" })).status).toBe(403);
    expect(proposeMock).not.toHaveBeenCalled();
  });

  it("400 para corpo presente e inválido (action desconhecida / accepted vazio)", async () => {
    expect((await call({ action: "explodir" })).status).toBe(400);
    expect((await call({ action: "apply", accepted: [] })).status).toBe(400);
    expect(proposeMock).not.toHaveBeenCalled();
    expect(applyMock).not.toHaveBeenCalled();
  });

  it("400 para apply SEM docTextHash: omitir o hash desligaria a recusa em bloco", async () => {
    const res = await call({
      action: "apply",
      accepted: [{ token: "aluguel_valor", trecho: "R$ 1.000,00" }],
    });
    expect(res.status).toBe(400);
    expect(applyMock).not.toHaveBeenCalled();
  });
});

describe("propose", () => {
  it("sem corpo = propose: devolve as propostas e NÃO passa pelo caminho de escrita", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.proposal.proposals).toHaveLength(1);
    expect(data.proposal.docTextHash).toBe("h1");
    expect(proposeMock).toHaveBeenCalledWith({ docId: "doc1", modalidade: "locacao", orgId: "org1" });
    expect(applyMock).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("persiste só a contagem (sem trecho) e preserva o relatório anterior", async () => {
    await call({ action: "propose" });
    const data = templateUpdate.mock.calls[0][0].data.draftReport as Record<string, unknown>;
    expect(data.slots).toBeDefined();
    const last = data.lastProposal as Record<string, unknown>;
    expect(last.count).toBe(1);
    expect(JSON.stringify(last)).not.toContain("R$ 1.000,00");
  });

  it("modelo ativo PODE propor (é leitura)", async () => {
    templateFindFirst.mockResolvedValue(template({ status: "active" }));
    expect((await call({ action: "propose" })).status).toBe(200);
  });
});

describe("apply", () => {
  const ACEITAS = [{ token: "aluguel_valor", trecho: "R$ 1.000,00" }];

  it("passa a lista aceita e o hash ao módulo; devolve o relatório mesclado com os slots", async () => {
    const res = await call({ action: "apply", accepted: ACEITAS, docTextHash: "h1" });
    expect(res.status).toBe(200);
    expect(applyMock).toHaveBeenCalledWith({
      docId: "doc1",
      modalidade: "locacao",
      accepted: ACEITAS,
      docTextHash: "h1",
    });
    const data = await res.json();
    expect(data.report.inserted).toHaveLength(1);
    expect(data.report.slots).toHaveLength(1);
    expect(data.report.lastProposal).toBeUndefined();
    expect(proposeMock).not.toHaveBeenCalled();
  });

  it("audita a escrita com chaves e motivos — nunca o trecho cru", async () => {
    await call({ action: "apply", accepted: ACEITAS, docTextHash: "h1" });
    expect(auditMock).toHaveBeenCalledTimes(1);
    const [, entry] = auditMock.mock.calls[0];
    expect(entry.action).toBe("TEMPLATE_AI_PROPOSALS_APPLIED");
    expect(entry.result).toBe("SUCCESS");
    expect(entry.metadata.inserted).toEqual(["aluguel_valor"]);
    expect(JSON.stringify(entry.metadata)).not.toContain("R$ 1.000,00");
  });

  it("409 DOC_CHANGED quando o Doc mudou desde a proposta; nada gravado", async () => {
    applyMock.mockRejectedValue(new DocChangedError());
    const res = await call({ action: "apply", accepted: ACEITAS, docTextHash: "velho" });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("DOC_CHANGED");
    expect(auditMock).not.toHaveBeenCalled();
    expect(templateUpdate).not.toHaveBeenCalled();
  });

  it("409 TEMPLATE_ACTIVE: modelo ativo não recebe escrita", async () => {
    templateFindFirst.mockResolvedValue(template({ status: "active" }));
    const res = await call({ action: "apply", accepted: ACEITAS, docTextHash: "h1" });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("TEMPLATE_ACTIVE");
    expect(applyMock).not.toHaveBeenCalled();
  });
});
