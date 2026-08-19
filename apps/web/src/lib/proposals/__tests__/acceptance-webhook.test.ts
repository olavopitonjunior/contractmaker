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

vi.mock("../send-execute", () => ({
  sendVendedorVia: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("../notify-proposal", () => ({
  notifyProposalMilestone: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/clicksign/account", () => ({
  getSignatureSettings: vi.fn().mockResolvedValue({ proposalAutoChainVendedor: false }),
}));

import { processProposalAcceptanceEvent } from "../acceptance-webhook";
import { advanceProposalStatus } from "../status";
import { buildAcceptanceProof } from "../acceptance-proof";
import { syncAcceptanceRecord } from "../acceptance-record-sync";
import { sendVendedorVia } from "../send-execute";
import { notifyProposalMilestone } from "../notify-proposal";
import { getSignatureSettings } from "@/lib/clicksign/account";

const propFind = prisma.proposal.findFirst as unknown as ReturnType<typeof vi.fn>;
const propFindUnique = prisma.proposal.findUnique as unknown as ReturnType<typeof vi.fn>;
const signerFind = prisma.proposalSigner.findFirst as unknown as ReturnType<typeof vi.fn>;
const signerCountMock = prisma.proposalSigner.count as unknown as ReturnType<typeof vi.fn>;
const sendVend = sendVendedorVia as unknown as ReturnType<typeof vi.fn>;
const notify = notifyProposalMilestone as unknown as ReturnType<typeof vi.fn>;
const settings = getSignatureSettings as unknown as ReturnType<typeof vi.fn>;
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
    signerCountMock.mockResolvedValue(0);
    settings.mockResolvedValue({ proposalAutoChainVendedor: false });
    sendVend.mockResolvedValue({ ok: true });
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

  it("FLIP: proponente aceita COM vendedor cadastrado → PARA na decisão (comprovante mantido)", async () => {
    signerFind.mockResolvedValue(null); // fallback: acceptanceClicksignId da Proposal → proponente
    propFind.mockResolvedValue({ ...PROPOSAL, orgId: "org1", userId: "u1", status: "visualizada", validUntil: null });
    signerCountMock.mockResolvedValue(1);
    await processProposalAcceptanceEvent({ acceptanceId: "acc_1", phase: "completed", payload: {} });
    await flushWaitUntil();
    const dests = advance.mock.calls.map((c) => c[1]);
    expect(dests).toEqual(["assinada_proponente"]);
    expect(dests).not.toContain("completa");
    expect(sendVend).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ kind: "awaiting_decision" }));
    // O comprovante do aceite do proponente CONTINUA sendo gerado na parada.
    expect(proof).toHaveBeenCalled();
  });

  it("FLIP: auto-chain ON dispara a 2ª rodada do Aceite via dispatcher", async () => {
    signerFind.mockResolvedValue(null);
    propFind.mockResolvedValue({ ...PROPOSAL, orgId: "org1", userId: "u1", status: "visualizada", validUntil: null });
    signerCountMock.mockResolvedValue(1);
    settings.mockResolvedValue({ proposalAutoChainVendedor: true });
    await processProposalAcceptanceEvent({ acceptanceId: "acc_1", phase: "completed", payload: {} });
    await flushWaitUntil();
    expect(sendVend).toHaveBeenCalledWith("p1", "webhook");
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ kind: "signed_proponente" }));
  });

  it("paridade: aceite do VENDEDOR fecha o conjunto em aguardando_vendedor → completa", async () => {
    signerFind.mockResolvedValue({ id: "s2", role: "vendedor", proposalId: "p1" });
    propFindUnique.mockResolvedValue({ ...PROPOSAL, orgId: "org1", userId: "u1", status: "aguardando_vendedor", validUntil: null });
    signerCountMock.mockResolvedValue(0); // nenhum vendedor pendente após o update da linha
    await processProposalAcceptanceEvent({ acceptanceId: "acc_2", phase: "completed", payload: {} });
    await flushWaitUntil();
    expect(advance).toHaveBeenCalledWith(
      "p1",
      "completa",
      expect.objectContaining({ completedAt: expect.any(Date) })
    );
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ kind: "completed" }));
  });

  it("aceite do vendedor com OUTRO vendedor pendente NÃO completa", async () => {
    signerFind.mockResolvedValue({ id: "s2", role: "vendedor", proposalId: "p1" });
    propFindUnique.mockResolvedValue({ ...PROPOSAL, orgId: "org1", userId: "u1", status: "aguardando_vendedor", validUntil: null });
    signerCountMock.mockResolvedValue(1); // ainda falta um
    await processProposalAcceptanceEvent({ acceptanceId: "acc_2", phase: "completed", payload: {} });
    await flushWaitUntil();
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

describe("2ª via do Aceite — termo do vendedor morto e aceite órfão (2026-08)", () => {
  const eventCreate = prisma.proposalEvent.create as unknown as ReturnType<typeof vi.fn>;
  const propUpdateMany = prisma.proposal.updateMany as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Describe separado do principal → precisa do próprio reset (o beforeEach
    // de lá não roda aqui e o histórico de chamadas do arquivo inteiro vazaria).
    vi.clearAllMocks();
    h.pending.length = 0;
    advance.mockResolvedValue({ moved: true });
    signerCountMock.mockResolvedValue(0);
    settings.mockResolvedValue({ proposalAutoChainVendedor: false });
    eventCreate.mockResolvedValue({});
    propUpdateMany.mockResolvedValue({ count: 0 });
  });

  it("expired do termo do VENDEDOR devolve a proposta à parada de decisão (CAS + sino)", async () => {
    signerFind.mockResolvedValue({ id: "s2", role: "vendedor", proposalId: "p1" });
    propFindUnique.mockResolvedValue({
      ...PROPOSAL,
      orgId: "org1",
      userId: "u1",
      status: "aguardando_vendedor",
      validUntil: null,
    });
    propUpdateMany.mockResolvedValue({ count: 1 }); // CAS move

    await processProposalAcceptanceEvent({ acceptanceId: "acc_2", phase: "expired", payload: {} });
    await flushWaitUntil();

    expect(propUpdateMany).toHaveBeenCalledWith({
      where: { id: "p1", status: "aguardando_vendedor" },
      data: { status: "assinada_proponente" },
    });
    expect(eventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventName: "vendedor_via_canceled" }),
      })
    );
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "vendedor_send_failed",
        dedupeSuffix: "aceite-expired:s2",
      })
    );
    // E NÃO expira a proposta (isso é só pro termo do proponente).
    const dests = advance.mock.calls.map((c) => c[1]);
    expect(dests).not.toContain("expirada");
  });

  it("canceled do termo do vendedor: mesmo caminho de volta à decisão", async () => {
    signerFind.mockResolvedValue({ id: "s2", role: "vendedor", proposalId: "p1" });
    propFindUnique.mockResolvedValue({
      ...PROPOSAL,
      orgId: "org1",
      userId: "u1",
      status: "aguardando_vendedor",
      validUntil: null,
    });
    propUpdateMany.mockResolvedValue({ count: 1 });

    await processProposalAcceptanceEvent({ acceptanceId: "acc_2", phase: "canceled", payload: {} });
    await flushWaitUntil();

    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "vendedor_send_failed", dedupeSuffix: "aceite-canceled:s2" })
    );
    const dests = advance.mock.calls.map((c) => c[1]);
    expect(dests).not.toContain("cancelada");
  });

  it("replay (proposta já saiu de aguardando_vendedor) → no-op sem sino", async () => {
    signerFind.mockResolvedValue({ id: "s2", role: "vendedor", proposalId: "p1" });
    propFindUnique.mockResolvedValue({
      ...PROPOSAL,
      orgId: "org1",
      userId: "u1",
      status: "assinada_proponente",
      validUntil: null,
    });
    propUpdateMany.mockResolvedValue({ count: 0 }); // CAS não move

    await processProposalAcceptanceEvent({ acceptanceId: "acc_2", phase: "expired", payload: {} });
    await flushWaitUntil();

    expect(notify).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: "vendedor_send_failed" })
    );
  });

  it("completed de terceiro em proposta MORTA → evento de aceite órfão + sino (antes era silêncio)", async () => {
    signerFind.mockResolvedValue({ id: "s2", role: "vendedor", proposalId: "p1" });
    propFindUnique.mockResolvedValue({
      ...PROPOSAL,
      orgId: "org1",
      userId: "u1",
      status: "expirada",
      validUntil: null,
    });

    await processProposalAcceptanceEvent({
      acceptanceId: "acc_2",
      phase: "completed",
      payload: {},
    });
    await flushWaitUntil();

    expect(eventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventName: "acceptance_orphan_after_terminal" }),
      })
    );
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "accepted_party", dedupeSuffix: "orphan:s2" })
    );
  });
});
