import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";

// O comprovante agora é montado DEPOIS de consultar a ClickSign (precisa dos
// dados oficiais pra capa), então não é mais chamado no mesmo tick. Coleta os
// fire-and-forget pra poder aguardá-los antes de assertar.
const h = vi.hoisted(() => ({ pending: [] as Promise<unknown>[] }));
vi.mock("@vercel/functions", () => ({
  waitUntil: (p: Promise<unknown>) => {
    h.pending.push(p);
    return p;
  },
}));
const flushWaitUntil = () => Promise.all(h.pending);

vi.mock("../acceptance-record-sync", () => ({
  syncAcceptanceRecord: vi.fn().mockResolvedValue({
    facts: { status: "completed", message: "Declaro que li..." },
    recordUrl: null,
    raw: {},
  }),
}));

vi.mock("../status", () => ({
  advanceProposalStatus: vi.fn().mockResolvedValue({ moved: true }),
}));

vi.mock("../acceptance-proof", () => ({
  buildAcceptanceProof: vi.fn().mockResolvedValue({ url: "https://x/comprovante.pdf" }),
  buildAcceptanceMessage: vi.fn().mockReturnValue("Declaro que li..."),
}));

import { processProposalAcceptanceEvent } from "../acceptance-webhook";
import { advanceProposalStatus } from "../status";
import { buildAcceptanceProof } from "../acceptance-proof";
import { syncAcceptanceRecord } from "../acceptance-record-sync";

const propFind = prisma.proposal.findFirst as unknown as ReturnType<typeof vi.fn>;
const propFindUnique = prisma.proposal.findUnique as unknown as ReturnType<typeof vi.fn>;
const signerFind = prisma.proposalSigner.findFirst as unknown as ReturnType<typeof vi.fn>;
const advance = advanceProposalStatus as unknown as ReturnType<typeof vi.fn>;
const proof = buildAcceptanceProof as unknown as ReturnType<typeof vi.fn>;
const sync = syncAcceptanceRecord as unknown as ReturnType<typeof vi.fn>;

const PROPOSAL = { id: "p1", title: "Proposta X", token: "tok", instrument: "aceite" };

describe("processProposalAcceptanceEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.pending.length = 0;
    advance.mockResolvedValue({ moved: true });
    proof.mockResolvedValue({ url: "https://x/comprovante.pdf" });
    sync.mockResolvedValue({
      facts: { status: "completed", message: "Declaro que li..." },
      recordUrl: null,
      raw: {},
    });
  });

  it("acceptance_term id desconhecido → unknownAcceptance, sem mutação", async () => {
    propFind.mockResolvedValue(null);
    const r = await processProposalAcceptanceEvent({
      acceptanceId: "acc_x",
      phase: "completed",
      payload: {},
    });
    expect(r.unknownAcceptance).toBe(true);
    expect(advance).not.toHaveBeenCalled();
  });

  it("sent → entregue (deliveredAt)", async () => {
    propFind.mockResolvedValue(PROPOSAL);
    await processProposalAcceptanceEvent({ acceptanceId: "acc_1", phase: "sent", payload: {} });
    expect(advance).toHaveBeenCalledWith(
      "p1",
      "entregue",
      expect.objectContaining({ deliveredAt: expect.any(Date) })
    );
  });

  it("completed → assinada_proponente → completa + comprovante", async () => {
    propFind.mockResolvedValue(PROPOSAL);
    await processProposalAcceptanceEvent({
      acceptanceId: "acc_1",
      phase: "completed",
      payload: { event: { data: { acceptance_term: { signer_name: "Ana", signer_phone: "5541999" } } } },
    });
    const dests = advance.mock.calls.map((c) => c[1]);
    expect(dests).toEqual(["assinada_proponente", "completa"]);
    await flushWaitUntil();
    expect(proof).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ signerName: "Ana", acceptanceId: "acc_1" })
    );
  });

  it("completed → busca os dados oficiais na ClickSign e os repassa ao comprovante", async () => {
    propFind.mockResolvedValue({ ...PROPOSAL, orgId: "org1" });
    await processProposalAcceptanceEvent({
      acceptanceId: "acc_1",
      phase: "completed",
      payload: { event: { data: { acceptance_term: { signer_name: "Ana" } } } },
    });
    await flushWaitUntil();

    expect(sync).toHaveBeenCalledWith(
      expect.objectContaining({ proposalId: "p1", acceptanceId: "acc_1" })
    );
    expect(proof).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ official: { status: "completed", message: "Declaro que li..." } })
    );
  });

  it("sync que LANÇA não derruba o comprovante", async () => {
    propFind.mockResolvedValue(PROPOSAL);
    sync.mockRejectedValue(new Error("boom"));

    await processProposalAcceptanceEvent({
      acceptanceId: "acc_1",
      phase: "completed",
      payload: { event: { data: { acceptance_term: { signer_name: "Ana" } } } },
    });
    await flushWaitUntil();

    expect(proof).toHaveBeenCalledWith("p1", expect.objectContaining({ signerName: "Ana" }));
  });

  it("ClickSign fora do ar não impede o comprovante — só perde o bloco oficial", async () => {
    // Garantia central: o comprovante é o único artefato do Aceite do nosso
    // lado. Falha na consulta NÃO pode deixar a proposta sem documento final.
    propFind.mockResolvedValue(PROPOSAL);
    sync.mockResolvedValue({ facts: {}, recordUrl: null, raw: null, error: "HTTP 500" });

    await processProposalAcceptanceEvent({
      acceptanceId: "acc_1",
      phase: "completed",
      payload: { event: { data: { acceptance_term: { signer_name: "Ana" } } } },
    });
    await flushWaitUntil();

    expect(proof).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ signerName: "Ana", official: {} })
    );
  });

  it("refused → recusada_proponente", async () => {
    propFind.mockResolvedValue(PROPOSAL);
    await processProposalAcceptanceEvent({ acceptanceId: "acc_1", phase: "refused", payload: {} });
    expect(advance).toHaveBeenCalledWith(
      "p1",
      "recusada_proponente",
      expect.objectContaining({ refusedAt: expect.any(Date) })
    );
    expect(proof).not.toHaveBeenCalled();
  });

  it("expired → expirada (terminal)", async () => {
    propFind.mockResolvedValue(PROPOSAL);
    await processProposalAcceptanceEvent({ acceptanceId: "acc_1", phase: "expired", payload: {} });
    expect(advance).toHaveBeenCalledWith(
      "p1",
      "expirada",
      expect.objectContaining({ expiredAt: expect.any(Date) })
    );
  });

  it("fase desconhecida (created) → só registra, sem mutação de status", async () => {
    propFind.mockResolvedValue(PROPOSAL);
    const r = await processProposalAcceptanceEvent({ acceptanceId: "acc_1", phase: "created", payload: {} });
    expect(r.handled).toBe(false);
    expect(advance).not.toHaveBeenCalled();
  });

  it("completed de NÃO-proponente → não completa (só registra a linha)", async () => {
    // Resolve por signatário: role vendedor → não é o proponente.
    signerFind.mockResolvedValue({ id: "s2", role: "vendedor", proposalId: "p1" });
    propFindUnique.mockResolvedValue({ ...PROPOSAL, validUntil: null });
    const r = await processProposalAcceptanceEvent({ acceptanceId: "acc_2", phase: "completed", payload: {} });
    expect(r.handled).toBe(true);
    // Não deve ter chamado assinada_proponente/completa.
    const dests = advance.mock.calls.map((c) => c[1]);
    expect(dests).not.toContain("completa");
  });

  it("refused por VENDEDOR → recusada_vendedor (não recusada_proponente)", async () => {
    signerFind.mockResolvedValue({ id: "s2", role: "vendedor", proposalId: "p1" });
    propFindUnique.mockResolvedValue({ ...PROPOSAL, validUntil: null });
    await processProposalAcceptanceEvent({ acceptanceId: "acc_2", phase: "refused", payload: {} });
    const dests = advance.mock.calls.map((c) => c[1]);
    expect(dests).toContain("recusada_vendedor");
    expect(dests).not.toContain("recusada_proponente");
  });

  it("expired de termo de TERCEIRO → não expira a proposta", async () => {
    signerFind.mockResolvedValue({ id: "s2", role: "vendedor", proposalId: "p1" });
    propFindUnique.mockResolvedValue({ ...PROPOSAL, validUntil: null });
    await processProposalAcceptanceEvent({ acceptanceId: "acc_2", phase: "expired", payload: {} });
    const dests = advance.mock.calls.map((c) => c[1]);
    expect(dests).not.toContain("expirada");
  });

  it("completed dentro do prazo (completed_at < validUntil) mas processado depois → COMPLETA", async () => {
    // Aceite às 23:59; webhook chega 00:05 (após validUntil 00:00). Deve completar.
    signerFind.mockResolvedValue({ id: "s1", role: "proponente", proposalId: "p1" });
    propFindUnique.mockResolvedValue({
      ...PROPOSAL,
      validUntil: new Date("2026-07-16T00:00:00Z"),
    });
    await processProposalAcceptanceEvent({
      acceptanceId: "acc_1",
      phase: "completed",
      payload: {
        event: {
          occurred_at: "2026-07-16T00:05:00Z",
          data: { acceptance_term: { completed_at: "2026-07-15T23:59:00Z" } },
        },
      },
    });
    const dests = advance.mock.calls.map((c) => c[1]);
    expect(dests).toContain("completa");
    expect(dests).not.toContain("expirada");
  });

  it("completed do proponente APÓS validUntil → expira, não completa (CC art. 431)", async () => {
    signerFind.mockResolvedValue({ id: "s1", role: "proponente", proposalId: "p1" });
    propFindUnique.mockResolvedValue({
      ...PROPOSAL,
      validUntil: new Date(Date.now() - 24 * 3600 * 1000), // ontem
    });
    await processProposalAcceptanceEvent({ acceptanceId: "acc_1", phase: "completed", payload: {} });
    const dests = advance.mock.calls.map((c) => c[1]);
    expect(dests).toContain("expirada");
    expect(dests).not.toContain("completa");
    expect(proof).not.toHaveBeenCalled();
  });
});
