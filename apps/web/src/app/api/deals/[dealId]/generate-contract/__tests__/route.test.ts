/**
 * Gêmeo bearer do generate-contract. Duas coisas travadas aqui:
 *
 * 1. A recusa do `templateId` NÃO pode distinguir "não existe" de "existe, mas
 *    é de outra imobiliária" — senão um token vira oráculo de enumeração. Os
 *    dois motivos existem separados no código e saem com a MESMA frase.
 * 2. Chamada sem corpo tem que continuar funcionando: integrações e o Newton
 *    chamam esta rota sem body e sem Content-Type.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";

const requireApiAuthMock = vi.fn();
vi.mock("@/lib/api/require-auth", () => ({
  requireApiAuth: (...args: unknown[]) => requireApiAuthMock(...args),
  isAuthFailure: (r: unknown) => (r as { ok?: boolean })?.ok === false,
  authFailureResponse: () => new Response("unauthorized", { status: 401 }),
}));

const guardDealScopeMock = vi.fn();
vi.mock("@/lib/deals/route-helpers", () => ({
  guardDealScope: (...args: unknown[]) => guardDealScopeMock(...args),
}));

const generateLocacaoMock = vi.fn();
vi.mock("@/lib/services/contract-generation", () => ({
  generateContractForDeal: vi.fn(),
  generateLocacaoContractForDeal: (...args: unknown[]) =>
    generateLocacaoMock(...args),
}));

vi.mock("@/lib/security/audit", () => ({
  audit: vi.fn(),
  extractAuditContextFromRequest: () => ({}),
}));
vi.mock("@/lib/audit/newton", () => ({
  mergeAuditMetadata: (m: unknown) => m,
}));

import { POST } from "../route";

const ORG_ID = "org-1";
const DEAL_ID = "deal-1";
const mockPrisma = vi.mocked(prisma);

function post(body?: unknown) {
  return POST(
    new NextRequest(
      `http://localhost/api/deals/${DEAL_ID}/generate-contract`,
      {
        method: "POST",
        ...(body
          ? {
              body: JSON.stringify(body),
              headers: { "Content-Type": "application/json" },
            }
          : {}),
      }
    ),
    { params: { dealId: DEAL_ID } }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  requireApiAuthMock.mockResolvedValue({
    ok: true,
    org: { id: ORG_ID },
    actor: { effectiveUserId: "bot-1" },
    ident: { via: "bearer" },
  });
  guardDealScopeMock.mockResolvedValue(null);
  generateLocacaoMock.mockResolvedValue({ contractId: "c1", version: 1 });
  mockPrisma.deal.findUnique.mockResolvedValue({
    kind: "locacao",
    pipeline: { orgId: ORG_ID },
    form: null,
  } as never);
});

describe("POST /api/deals/[dealId]/generate-contract (bearer)", () => {
  it("sem body segue gerando pelo automático", async () => {
    const res = await post();
    expect(res.status).toBe(201);
    expect(generateLocacaoMock).toHaveBeenCalledWith(DEAL_ID, "bot-1", ORG_ID, {
      template: undefined,
    });
  });

  it("templateId válido é repassado ao gerador", async () => {
    const tpl = {
      id: "t1",
      orgId: ORG_ID,
      status: "active",
      modalidade: "temporada",
      name: "Curta temporada",
    };
    mockPrisma.contractTemplate.findUnique.mockResolvedValue(tpl as never);

    const res = await post({ templateId: "t1" });

    expect(res.status).toBe(201);
    expect(generateLocacaoMock).toHaveBeenCalledWith(DEAL_ID, "bot-1", ORG_ID, {
      template: tpl,
    });
  });

  it("REGRESSÃO: template inexistente e de outra org devolvem a MESMA mensagem", async () => {
    mockPrisma.contractTemplate.findUnique.mockResolvedValue(null as never);
    const inexistente = await (await post({ templateId: "nao-existe" })).json();

    mockPrisma.contractTemplate.findUnique.mockResolvedValue({
      id: "t-alheio",
      orgId: "outra-org",
      status: "active",
      modalidade: "locacao",
    } as never);
    const alheio = await (await post({ templateId: "t-alheio" })).json();

    // Se estas duas divergirem, o `reason` vira oráculo: dá pra varrer ids e
    // descobrir quais existem em OUTRAS imobiliárias.
    expect(alheio).toEqual(inexistente);
    expect(alheio.error).not.toContain("cross-org");
    expect(generateLocacaoMock).not.toHaveBeenCalled();
  });

  it("modelo de administração de locação é recusado e nada é gerado", async () => {
    mockPrisma.contractTemplate.findUnique.mockResolvedValue({
      id: "t-adm",
      orgId: ORG_ID,
      status: "active",
      modalidade: "administracao_locacao",
    } as never);

    expect((await post({ templateId: "t-adm" })).status).toBe(400);
    expect(generateLocacaoMock).not.toHaveBeenCalled();
  });
});
