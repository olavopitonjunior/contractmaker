import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";

/**
 * A SÉTIMA PORTA (#514).
 *
 * `POST /api/proposals/[id]/convert` cria `Deal` + `SalesForm`, mas era gateada
 * só por `PROPOSAL_CONVERT`. As duas chaves são configuráveis na MESMA tela
 * (/settings/gerentes, via `MANAGER_CONFIGURABLE_PERMISSIONS`) — em grupos
 * diferentes, "Propostas" e "Pipeline & Contratos" —, então o admin que
 * desligava "Criar negócio de venda" lia a tela como fechada e o gerente seguia
 * criando negócio por aqui.
 *
 * Estes testes NÃO mockam `guardDealCreate` nem `rbac/check` — de propósito.
 * O que se mede é a composição real preset + override da org, com o Prisma
 * mockado por baixo. Os casos reproduzem a configuração medida em produção em
 * 2026-09-02: Newcore e RE/MAX Ativa com `proposal.convert=true`, só a Ativa
 * com `lease.create=true`.
 */

vi.mock("@/lib/auth/impersonation", () => ({
  getEffectiveUserId: vi.fn(async (id: string) => id),
}));

vi.mock("@/lib/api/intent-executors", () => ({
  ensureIntentExecutorsRegistered: vi.fn(),
}));

vi.mock("@/lib/modules/guard", () => ({
  assertFeatureEnabled: vi.fn(async () => undefined),
  ModuleDisabledError: class ModuleDisabledError extends Error {
    code = "module_disabled";
    status = 403;
  },
}));

const convertMock = vi.fn(async () => ({ dealId: "deal-1", formId: "form-1" }));
vi.mock("@/lib/proposals/convert", () => ({
  convertProposalToDeal: (...a: unknown[]) => convertMock(...(a as [])),
  ProposalConvertError: class ProposalConvertError extends Error {
    code = "x";
  },
}));

const requireApiAuthMock = vi.fn();
vi.mock("@/lib/api/require-auth", () => ({
  requireApiAuth: (...a: unknown[]) => requireApiAuthMock(...(a as [])),
  isAuthFailure: (v: unknown) => v === null,
  authFailureResponse: () =>
    new Response(JSON.stringify({ error: "unauth" }), { status: 401 }),
}));

import { POST } from "../route";

const ATOR = "user-ator";
const ORG = "org-1";

const membershipFind = prisma.orgMembership
  .findUnique as unknown as ReturnType<typeof vi.fn>;
const managerSettingsFind = prisma.orgManagerSettings
  .findUnique as unknown as ReturnType<typeof vi.fn>;
const proposalFind = prisma.proposal
  .findUnique as unknown as ReturnType<typeof vi.fn>;

/** Ator com papel `role`; `overrides` é o OrgManagerSettings.permissionsJson. */
function comAtor(role: string, overrides?: Record<string, boolean>) {
  membershipFind.mockResolvedValue({
    userId: ATOR,
    orgId: ORG,
    role,
    customRole: null,
  });
  managerSettingsFind.mockResolvedValue(
    overrides ? { permissionsJson: overrides } : null
  );
}

function comProposta(kind: "venda" | "locacao") {
  proposalFind.mockResolvedValue({
    id: "prop-1",
    orgId: ORG,
    userId: ATOR,
    responsibleUserId: ATOR,
    kind,
    title: "Proposta",
    status: "completa",
  });
}

function comVia(via: "session" | "bearer") {
  requireApiAuthMock.mockResolvedValue({
    ident: { via, userId: ATOR, tokenId: via === "bearer" ? "tok-1" : null },
    org: { id: ORG },
    actor: { effectiveUserId: ATOR },
  });
}

async function converter() {
  const req = new NextRequest("http://localhost/api/proposals/prop-1/convert", {
    method: "POST",
    body: "{}",
    headers: { "content-type": "application/json" },
  });
  return POST(req, { params: { id: "prop-1" } });
}

// A configuração real da Newcore em produção (medida em 2026-09-02).
const NEWCORE = { "proposal.convert": true };
// A da RE/MAX Ativa: mesma coisa, mais locação liberada.
const ATIVA = { "proposal.convert": true, "lease.create": true };

describe("POST /api/proposals/[id]/convert — gate de criação por kind (#514)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    convertMock.mockResolvedValue({ dealId: "deal-1", formId: "form-1" });
    // Caminho Bearer: `requireApproval` cria um ActionIntent em vez de executar.
    (
      prisma.actionIntent.create as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: "intent-1",
      status: "pending",
      expiresAt: new Date(Date.now() + 86_400_000),
    });
  });

  it("gerente da Newcore converte proposta de VENDA — não regride, DEAL_CREATE vem do preset base", async () => {
    comVia("session");
    comAtor("gerente", NEWCORE);
    comProposta("venda");
    const res = await converter();
    expect(res.status).toBe(201);
    expect(convertMock).toHaveBeenCalledTimes(1);
  });

  it("gerente da Newcore NÃO converte proposta de LOCAÇÃO — cobra lease.create, que a org não ligou", async () => {
    comVia("session");
    comAtor("gerente", NEWCORE);
    comProposta("locacao");
    const res = await converter();
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: "PERMISSION_DENIED",
      permission: "lease.create",
    });
    expect(convertMock).not.toHaveBeenCalled();
  });

  it("gerente da RE/MAX Ativa converte a MESMA proposta de locação — o checkbox reabre", async () => {
    comVia("session");
    comAtor("gerente", ATIVA);
    comProposta("locacao");
    const res = await converter();
    expect(res.status).toBe(201);
  });

  it("o toggle para de mentir: admin desliga 'Criar negócio de venda' e a conversão de venda FECHA", async () => {
    comVia("session");
    comAtor("gerente", { "proposal.convert": true, "deal.create": false });
    comProposta("venda");
    const res = await converter();
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      permission: "deal.create",
    });
  });

  it("admin converte os dois kinds — quem já convertia não perde", async () => {
    comVia("session");
    comAtor("admin");
    comProposta("venda");
    expect((await converter()).status).toBe(201);
    comProposta("locacao");
    expect((await converter()).status).toBe(201);
  });

  it("viewer para no gate ANTIGO (PROPOSAL_CONVERT), sem chegar no novo", async () => {
    comVia("session");
    comAtor("viewer");
    comProposta("venda");
    const res = await converter();
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ error: "Forbidden" });
  });

  it("Bearer não passa pelo gate de criação — o escopo do token governa (contrato M2M)", async () => {
    comVia("bearer");
    comAtor("gerente", NEWCORE);
    comProposta("locacao");
    const res = await converter();
    expect(res.status).not.toBe(403);
  });
});
