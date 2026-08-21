import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/lib/proposals/route-helpers", () => ({
  loadScopedProposal: vi.fn(),
}));
vi.mock("@/lib/clicksign/cancel-action", () => ({
  runEnvelopeCancel: vi.fn(),
}));
vi.mock("@/lib/security/audit", () => ({
  audit: vi.fn().mockResolvedValue(undefined),
  extractAuditContextFromRequest: vi.fn(() => ({})),
}));

import { PATCH, DELETE } from "../route";
import { loadScopedProposal } from "@/lib/proposals/route-helpers";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { resolvePermissions, ROLE_PRESETS } from "@/lib/security/rbac/roles";
import { prisma } from "@/lib/db/prisma";

const mockLoad = vi.mocked(loadScopedProposal);
const mockPrisma = vi.mocked(prisma);

function req(body: unknown) {
  return new NextRequest("http://localhost/api/proposals/p1", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

/** Permissões de quem PODE escrever — o default dos casos que testam status. */
const WRITER = { [PERMISSION.PROPOSAL_CREATE]: true };

function scoped(status: string, permissions: Record<string, boolean> = WRITER) {
  mockLoad.mockResolvedValue({
    auth: { org: { id: "org-1" }, actor: { effectiveUserId: "u1" } },
    eff: { permissions },
    proposal: {
      id: "p1",
      orgId: "org-1",
      status,
      schemaType: "locacao_residencial_v1",
    },
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.proposal.update.mockResolvedValue({ id: "p1" } as never);
  // Guarda atômica do PATCH: por padrão a proposta ainda está editável.
  mockPrisma.proposal.updateMany.mockResolvedValue({ count: 1 } as never);
});

describe("PATCH /api/proposals/[id] — escrita exige permissão, não só escopo", () => {
  // `loadScopedProposal` libera quem tem PROPOSAL_VIEW_ALL, e esse é o recorte
  // do papel `viewer`. Sem guard ele reescrevia dataJson e TROCAVA a lista de
  // signatários — as rotas irmãs que fazem isso em pedaços já exigiam
  // PROPOSAL_SEND; só este PATCH monolítico não exigia nada.
  it("papel somente-leitura (VIEW_ALL sem CREATE/SEND) → 403", async () => {
    const viewer = resolvePermissions("viewer") as Record<string, boolean>;
    expect(viewer[PERMISSION.PROPOSAL_VIEW_ALL]).toBe(true);
    scoped("rascunho", viewer);
    const res = await PATCH(
      req({ title: "x", dataJson: { a: 1 }, signers: [] }),
      { params: { id: "p1" } }
    );
    expect(res.status).toBe(403);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("NENHUM preset com VIEW_ALL e sem CREATE/SEND escreve", async () => {
    // Guarda de regressão pela FORMA da permissão, não pelo nome do papel: um
    // preset novo de auditoria ou portal cairia no mesmo buraco em silêncio.
    const readOnly = Object.entries(ROLE_PRESETS).filter(([, map]) => {
      const m = map as Record<string, boolean>;
      return (
        m[PERMISSION.PROPOSAL_VIEW_ALL] &&
        !m[PERMISSION.PROPOSAL_CREATE] &&
        !m[PERMISSION.PROPOSAL_SEND]
      );
    });
    expect(readOnly.length).toBeGreaterThan(0); // senão o teste vira vacuidade
    for (const [role, map] of readOnly) {
      scoped("rascunho", map as Record<string, boolean>);
      const res = await PATCH(req({ title: "x" }), { params: { id: "p1" } });
      expect(res.status, role).toBe(403);
    }
  });

  it("quem pode CRIAR escreve", async () => {
    scoped("rascunho", { [PERMISSION.PROPOSAL_CREATE]: true });
    const res = await PATCH(req({ title: "x" }), { params: { id: "p1" } });
    expect(res.status).toBe(200);
  });

  it("quem pode ENVIAR escreve", async () => {
    scoped("rascunho", { [PERMISSION.PROPOSAL_SEND]: true });
    const res = await PATCH(req({ title: "x" }), { params: { id: "p1" } });
    expect(res.status).toBe(200);
  });
});

describe("PATCH /api/proposals/[id] — guard de status", () => {
  it("propaga o 404 do escopo (outra org / sem acesso)", async () => {
    mockLoad.mockResolvedValue({
      fail: NextResponse.json({ error: "Não encontrada" }, { status: 404 }),
    } as never);
    const res = await PATCH(req({ title: "x" }), { params: { id: "p1" } });
    expect(res.status).toBe(404);
    expect(mockPrisma.proposal.update).not.toHaveBeenCalled();
  });

  it("409 depois do envio — documento enviado não se edita", async () => {
    for (const status of [
      "enviada",
      "entregue",
      "visualizada",
      "assinada_proponente",
      "aguardando_vendedor",
      "completa",
      "convertida",
      "cancelada",
      "expirada",
      "recusada_proponente",
    ]) {
      scoped(status);
      const res = await PATCH(req({ title: "novo" }), { params: { id: "p1" } });
      expect(res.status, status).toBe(409);
    }
    expect(mockPrisma.proposal.update).not.toHaveBeenCalled();
  });

  it("200 nos três status editáveis (mesmo conjunto do claim de envio)", async () => {
    for (const status of ["rascunho", "aguardando_aprovacao", "falha_envio"]) {
      scoped(status);
      const res = await PATCH(req({ title: "novo" }), { params: { id: "p1" } });
      expect(res.status, status).toBe(200);
    }
    expect(mockPrisma.proposal.update).toHaveBeenCalledTimes(3);
  });

  it("400 em payload inválido", async () => {
    scoped("rascunho");
    const res = await PATCH(req({ title: "" }), { params: { id: "p1" } });
    expect(res.status).toBe(400);
  });

  it("hiddenPaths fora da allowlist do schemaType é descartado", async () => {
    scoped("rascunho");
    await PATCH(
      req({ hiddenPaths: ["comissao", "compradores.0.cpf", "../../etc/passwd"] }),
      { params: { id: "p1" } }
    );
    expect(mockPrisma.proposal.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ hiddenPaths: ["comissao"] }) })
    );
  });
});

describe("PATCH /api/proposals/[id] — substituição de signatários", () => {
  it("substitui o conjunto inteiro (delete + create) com dedupeKey", async () => {
    scoped("rascunho");
    const res = await PATCH(
      req({
        signers: [
          { role: "proponente", name: "Maria", email: "m@ex.com" },
          { role: "testemunha", name: "Testa", email: "t@ex.com", cpf: "99988877766" },
        ],
      }),
      { params: { id: "p1" } }
    );
    expect(res.status).toBe(200);
    expect(mockPrisma.proposalSigner.deleteMany).toHaveBeenCalledWith({
      where: { proposalId: "p1" },
    });
    const created = mockPrisma.proposalSigner.createMany.mock.calls[0][0] as {
      data: Record<string, unknown>[];
    };
    expect(created.data).toHaveLength(2);
    // Grupo derivado do papel (proponente assina primeiro) e chave de dedupe
    // calculada no servidor.
    expect(created.data[0]).toMatchObject({ role: "proponente", signingGroup: 1 });
    expect(created.data[1]).toMatchObject({ role: "testemunha", signingGroup: 2 });
    expect(created.data[0].dedupeKey).toBeTruthy();
  });

  it("omitir `signers` preserva as linhas existentes", async () => {
    scoped("rascunho");
    await PATCH(req({ title: "só o título" }), { params: { id: "p1" } });
    expect(mockPrisma.proposalSigner.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.proposalSigner.createMany).not.toHaveBeenCalled();
  });

  it("lista vazia limpa sem tentar criar nada", async () => {
    scoped("rascunho");
    await PATCH(req({ signers: [] }), { params: { id: "p1" } });
    expect(mockPrisma.proposalSigner.deleteMany).toHaveBeenCalled();
    expect(mockPrisma.proposalSigner.createMany).not.toHaveBeenCalled();
  });
});

/**
 * O guard de status no topo da rota é check-then-act: entre a leitura e a
 * transação, o claim de envio (`executeProposalSend`, mesmo conjunto de status)
 * pode ter movido a proposta pra "enviada". Sem a guarda atômica, os
 * signatários eram substituídos por baixo do envio.
 */
describe("PATCH /api/proposals/[id] — corrida com o claim de envio", () => {
  it("guarda atômica usa o MESMO conjunto de status do claim de envio", async () => {
    scoped("rascunho");
    await PATCH(req({ title: "novo" }), { params: { id: "p1" } });

    const call = mockPrisma.proposal.updateMany.mock.calls[0][0] as {
      where: { id: string; status: { in: string[] } };
    };
    expect(call.where.id).toBe("p1");
    expect([...call.where.status.in].sort()).toEqual([
      "aguardando_aprovacao",
      "falha_envio",
      "rascunho",
    ]);
  });

  it("status mudou entre o load e a transação → 409 e nada é gravado", async () => {
    scoped("rascunho"); // a leitura ainda vê "rascunho"…
    // …mas quando a transação abre, o claim de envio já levou a proposta.
    mockPrisma.proposal.updateMany.mockResolvedValue({ count: 0 } as never);

    const res = await PATCH(
      req({ signers: [{ role: "proponente", name: "Maria", email: "m@ex.com" }] }),
      { params: { id: "p1" } }
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "A proposta já foi enviada e não pode mais ser editada.",
    });
    // A guarda vem ANTES de mexer nos signatários — a lista do envelope fica
    // exatamente como o claim de envio a congelou.
    expect(mockPrisma.proposalSigner.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.proposalSigner.createMany).not.toHaveBeenCalled();
    expect(mockPrisma.proposal.update).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/proposals/[id] — proposta que já circulou não se apaga", () => {
  function scopedForDelete(over: Record<string, unknown>) {
    mockLoad.mockResolvedValue({
      auth: { org: { id: "org-1" }, actor: { effectiveUserId: "u1" } },
      eff: { permissions: { [PERMISSION.PROPOSAL_DELETE]: true } },
      proposal: {
        id: "p1",
        orgId: "org-1",
        status: "falha_envio",
        convertedDealId: null,
        sentAt: null,
        ...over,
      },
    } as never);
  }

  function req() {
    return new NextRequest("http://localhost/api/proposals/p1", { method: "DELETE" });
  }

  it("falha_envio COM sentAt → 409: cancelar em vez de excluir", async () => {
    // Este é o estado novo: `falha_envio` alcançado por cancelamento de
    // envelope de uma proposta que o cliente recebeu e abriu. Apagar
    // cascatearia ProposalEvent, envelopes e signatários.
    scopedForDelete({ sentAt: new Date("2026-08-19T12:00:00Z") });
    const res = await DELETE(req(), { params: { id: "p1" } });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/já foi enviada/i);
  });

  it("falha_envio SEM sentAt → segue (envio que nunca saiu, ninguém viu)", async () => {
    scopedForDelete({ sentAt: null });
    mockPrisma.envelope.findMany.mockResolvedValue([] as never);
    // `proposal.delete` não está no mock global do prisma — stub local.
    (prisma as unknown as { proposal: { delete: ReturnType<typeof vi.fn> } }).proposal.delete =
      vi.fn().mockResolvedValue({});
    const res = await DELETE(req(), { params: { id: "p1" } });
    expect(res.status).not.toBe(409);
  });
});

/**
 * Thread de recriação no DELETE.
 *
 * `Proposal.supersededById` é escalar puro — não tem relation nem
 * `onDelete: SetNull` como o `parentProposalId`. Sem a limpeza explícita,
 * apagar o rascunho-filho deixa o pai apontando pra uma linha que não existe
 * mais, e o gate `!supersededById` esconde o botão "Recriar" PRA SEMPRE, sem
 * erro, sem log e sem caminho de UI pra recuperar. É regressão silenciosa —
 * daí o teste.
 */
describe("DELETE /api/proposals/[id] — limpa o ponteiro da recriação no pai", () => {
  function scopedChild(over: Record<string, unknown> = {}) {
    mockLoad.mockResolvedValue({
      auth: { org: { id: "org-1" }, actor: { effectiveUserId: "u1" } },
      eff: { permissions: { [PERMISSION.PROPOSAL_DELETE]: true } },
      proposal: {
        id: "child-1",
        orgId: "org-1",
        status: "rascunho",
        convertedDealId: null,
        sentAt: null,
        parentProposalId: "parent-1",
        ...over,
      },
    } as never);
  }

  function req() {
    return new NextRequest("http://localhost/api/proposals/child-1", { method: "DELETE" });
  }

  beforeEach(() => {
    mockPrisma.envelope.findMany.mockResolvedValue([] as never);
    (prisma as unknown as { proposal: { delete: ReturnType<typeof vi.fn> } }).proposal.delete =
      vi.fn().mockResolvedValue({});
    mockPrisma.proposal.updateMany.mockResolvedValue({ count: 1 } as never);
  });

  it("filho de uma recriação: o pai perde o supersededById e recupera o botão", async () => {
    scopedChild();
    const res = await DELETE(req(), { params: { id: "child-1" } });

    expect(res.status).toBe(200);
    expect(mockPrisma.proposal.updateMany).toHaveBeenCalledWith({
      where: { id: "parent-1", supersededById: "child-1" },
      data: { supersededById: null },
    });
  });

  it("o where é CONDICIONAL: pai que já aponta pra recriação mais nova não é limpo", async () => {
    // O `supersededById: <este filho>` no where é o que impede clobber. Recriar
    // duas vezes e apagar a filha ANTIGA não pode apagar o ponteiro pra nova.
    scopedChild();
    await DELETE(req(), { params: { id: "child-1" } });

    const call = mockPrisma.proposal.updateMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(call.where.supersededById).toBe("child-1");
  });

  it("proposta sem pai não dispara escrita nenhuma em outra linha", async () => {
    scopedChild({ parentProposalId: null });
    const res = await DELETE(req(), { params: { id: "child-1" } });

    expect(res.status).toBe(200);
    expect(mockPrisma.proposal.updateMany).not.toHaveBeenCalled();
  });

  /**
   * Limpeza e exclusão precisam ser ATÔMICAS. Enquanto eram duas chamadas
   * soltas — com um `.catch(() => {})` na segunda —, uma falha transitória de
   * banco entre elas produzia exatamente o ponteiro pendurado que a limpeza
   * existe pra evitar, e em silêncio. Este teste fixa a estrutura: uma
   * transação só, contendo as duas operações.
   */
  it("limpeza e exclusão vão na MESMA transação", async () => {
    scopedChild();
    await DELETE(req(), { params: { id: "child-1" } });

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    const ops = mockPrisma.$transaction.mock.calls[0][0] as unknown[];
    expect(Array.isArray(ops)).toBe(true);
    expect(ops).toHaveLength(2);
  });

  it("sem pai, a transação carrega só a exclusão", async () => {
    scopedChild({ parentProposalId: null });
    await DELETE(req(), { params: { id: "child-1" } });

    const ops = mockPrisma.$transaction.mock.calls[0][0] as unknown[];
    expect(ops).toHaveLength(1);
  });

  it("falha da transação NÃO vira 200 silencioso", async () => {
    // O `.catch(() => {})` anterior engolia o erro: o cliente recebia sucesso
    // enquanto o banco ficava inconsistente. Agora a falha tem que aparecer.
    scopedChild();
    mockPrisma.$transaction.mockRejectedValueOnce(new Error("deadlock"));

    await expect(DELETE(req(), { params: { id: "child-1" } })).rejects.toThrow(
      "deadlock"
    );
  });
});
