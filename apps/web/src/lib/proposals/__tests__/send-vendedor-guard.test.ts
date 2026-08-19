import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";

// Lock passa direto (o alvo do teste é o guard DENTRO do lock).
vi.mock("../send-lock", () => ({
  withVendedorSendLock: (_id: string, fn: () => unknown) => fn(),
}));

vi.mock("../notify-proposal", () => ({
  notifyProposalMilestone: vi.fn().mockResolvedValue(undefined),
}));

// Módulos pesados atrás do guard — nunca devem ser alcançados nestes testes,
// mas o import do send-execute os puxa.
vi.mock("@/lib/render/exporter", () => ({ exportPdfToBuffer: vi.fn() }));
vi.mock("@/lib/render/org-document-style", () => ({
  loadOrgDocumentStyleExport: vi.fn(),
}));

import { sendVendedorEnvelope, sendVendedorVia } from "../send-execute";
import { notifyProposalMilestone } from "../notify-proposal";

const propFind = prisma.proposal.findUnique as unknown as ReturnType<typeof vi.fn>;
const envFindFirst = prisma.envelope.findFirst as unknown as ReturnType<typeof vi.fn>;
const eventCreate = prisma.proposalEvent.create as unknown as ReturnType<typeof vi.fn>;
const signerFindMany = prisma.proposalSigner.findMany as unknown as ReturnType<typeof vi.fn>;
const notify = notifyProposalMilestone as unknown as ReturnType<typeof vi.fn>;

describe("sendVendedorEnvelope — guard anti-double-charge por status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    envFindFirst.mockResolvedValue(null); // nenhum envelope reduzida vivo
    eventCreate.mockResolvedValue({});
    signerFindMany.mockResolvedValue([]);
  });

  it.each(["completa", "convertida", "cancelada", "enviada", "recusada_vendedor"])(
    "status %s → wrong_status, SEM criar envelope (evento registrado)",
    async (status) => {
      propFind.mockResolvedValue({
        id: "p1",
        orgId: "org1",
        userId: "u1",
        status,
        validUntil: null,
        hiddenPaths: [],
      });
      const r = await sendVendedorEnvelope("p1", "webhook");
      expect(r).toEqual({
        ok: false,
        reason: "wrong_status",
        detail: `status atual: ${status}`,
      });
      expect(eventCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            eventName: "chained_envelope2_wrong_status",
          }),
        })
      );
      // Guard corta ANTES de qualquer caminho pago.
      expect(signerFindMany).not.toHaveBeenCalled();
    }
  );

  it("parada de decisão (assinada_proponente) passa o guard e segue o fluxo", async () => {
    propFind.mockResolvedValue({
      id: "p1",
      orgId: "org1",
      userId: "u1",
      status: "assinada_proponente",
      validUntil: null,
      hiddenPaths: [],
    });
    signerFindMany.mockResolvedValue([]); // sem vendedor → para em no_vendedor
    const r = await sendVendedorEnvelope("p1", "manual");
    expect(r).toEqual({ ok: false, reason: "no_vendedor" });
  });

  it("aguardando_vendedor (retry) também passa o guard", async () => {
    propFind.mockResolvedValue({
      id: "p1",
      orgId: "org1",
      userId: "u1",
      status: "aguardando_vendedor",
      validUntil: null,
      hiddenPaths: [],
    });
    signerFindMany.mockResolvedValue([]);
    const r = await sendVendedorEnvelope("p1", "cron");
    expect(r).toEqual({ ok: false, reason: "no_vendedor" });
  });

  it("proposta inexistente → not_found", async () => {
    propFind.mockResolvedValue(null);
    const r = await sendVendedorEnvelope("p1", "manual");
    expect(r).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("sendVendedorVia — dispatcher por instrumento", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    envFindFirst.mockResolvedValue(null);
    eventCreate.mockResolvedValue({});
    signerFindMany.mockResolvedValue([]);
  });

  it("instrument=aceite roteia pro braço de Aceite (guard de status incluso)", async () => {
    propFind
      .mockResolvedValueOnce({ instrument: "aceite" }) // dispatcher
      .mockResolvedValueOnce({
        id: "p1",
        orgId: "org1",
        userId: "u1",
        status: "completa",
        validUntil: null,
        title: "T",
        token: "tok",
      }); // locked (aceite)
    const r = await sendVendedorVia("p1", "webhook");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("wrong_status");
    expect(eventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventName: "chained_aceite2_wrong_status" }),
      })
    );
  });

  it("instrument=envelope → roteia pro envio de envelope (guard incluso)", async () => {
    propFind
      .mockResolvedValueOnce({ instrument: "envelope" }) // dispatcher
      .mockResolvedValueOnce({
        id: "p1",
        orgId: "org1",
        userId: "u1",
        status: "completa",
        validUntil: null,
        hiddenPaths: [],
      }); // locked
    const r = await sendVendedorVia("p1", "cron");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("wrong_status");
  });

  it("falha notifica vendedor_send_failed com dedupe por motivo (no_creds)", async () => {
    // status válido + vendedor presente + sem creds ClickSign.
    propFind
      .mockResolvedValueOnce({ instrument: "envelope" })
      .mockResolvedValueOnce({
        id: "p1",
        orgId: "org1",
        userId: "u1",
        status: "assinada_proponente",
        validUntil: null,
        hiddenPaths: [],
      });
    signerFindMany.mockResolvedValue([
      { name: "Dono", email: "d@x.com", cpf: null, phone: null, signingGroup: 2, notifyChannel: "email" },
    ]);
    const r = await sendVendedorVia("p1", "webhook");
    expect(r).toEqual({ ok: false, reason: "no_creds" });
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "vendedor_send_failed", dedupeSuffix: "no_creds" })
    );
  });
});

describe("sendVendedorAceiteLocked — termos legados e mortos (2026-08)", () => {
  const propUpdateMany = prisma.proposal.updateMany as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.envelope.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.proposalEvent.create as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});
  });

  const proposalAceite = {
    id: "p1",
    orgId: "org1",
    userId: "u1",
    status: "assinada_proponente",
    validUntil: null,
    title: "T",
    token: "tok",
  };

  it("legado com TODOS os vendedores completed → reconcilia em completa (não estaciona em aguardando_vendedor)", async () => {
    propFind
      .mockResolvedValueOnce({ instrument: "aceite" }) // dispatcher
      .mockResolvedValueOnce(proposalAceite) // locked
      .mockResolvedValueOnce({ status: "assinada_proponente" }); // pre-read do advance
    propUpdateMany.mockResolvedValue({ count: 1 }); // CAS → completa move
    signerFindMany.mockResolvedValue([
      { id: "s1", acceptanceClicksignId: "acc1", acceptanceStatus: "completed" },
      { id: "s2", acceptanceClicksignId: "acc2", acceptanceStatus: "completed" },
    ]);

    const r = await sendVendedorVia("p1", "manual");
    expect(r).toEqual({ ok: true, reconciled: "completa" });
    // Fechou em completa (CAS), não em aguardando_vendedor.
    expect(propUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "completa" }),
      })
    );
    expect(eventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventName: "chained_aceite2_reconciled_completa" }),
      })
    );
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ kind: "completed" }));
  });

  it("termos vivos (sent) em todos → already idempotente, status garantido", async () => {
    propFind
      .mockResolvedValueOnce({ instrument: "aceite" })
      .mockResolvedValueOnce({ ...proposalAceite, status: "aguardando_vendedor" })
      .mockResolvedValueOnce({ status: "aguardando_vendedor" });
    signerFindMany.mockResolvedValue([
      { id: "s1", acceptanceClicksignId: "acc1", acceptanceStatus: "sent" },
    ]);

    const r = await sendVendedorVia("p1", "cron");
    expect(r).toEqual({ ok: false, reason: "already" });
  });

  it("termo MORTO (expired) conta como pendente → segue pro fluxo de reemissão (para em no_creds aqui)", async () => {
    propFind
      .mockResolvedValueOnce({ instrument: "aceite" })
      .mockResolvedValueOnce(proposalAceite);
    signerFindMany.mockResolvedValue([
      {
        id: "s1",
        name: "Dono",
        email: null,
        cpf: null,
        phone: "11999998888",
        acceptanceClicksignId: "acc-dead",
        acceptanceStatus: "expired",
      },
    ]);

    const r = await sendVendedorVia("p1", "manual");
    // Não é "already": o termo morto entra em pending e o fluxo avança até
    // esbarrar nas creds ClickSign (não mockadas) — prova que a reemissão roda.
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no_creds");
  });

  it("CAS da reconciliação NÃO move (writer concorrente) → não diz 'reconciliada'", async () => {
    propFind
      .mockResolvedValueOnce({ instrument: "aceite" })
      .mockResolvedValueOnce(proposalAceite)
      .mockResolvedValueOnce({ status: "cancelada" }) // pre-read do advance
      .mockResolvedValueOnce({ status: "cancelada" }); // post-read (CAS falhou → por quê)
    propUpdateMany.mockResolvedValue({ count: 0 }); // CAS falha
    signerFindMany.mockResolvedValue([
      { id: "s1", acceptanceClicksignId: "acc1", acceptanceStatus: "completed" },
    ]);

    const r = await sendVendedorVia("p1", "manual");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("wrong_status");
    expect(notify).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "completed" }));
  });

  it("CAS replay (já está completa) → already idempotente", async () => {
    propFind
      .mockResolvedValueOnce({ instrument: "aceite" })
      .mockResolvedValueOnce(proposalAceite)
      .mockResolvedValueOnce({ status: "completa" }) // pre-read: já no destino
      .mockResolvedValueOnce({ status: "completa" }); // post-read → replay
    propUpdateMany.mockResolvedValue({ count: 0 });
    signerFindMany.mockResolvedValue([
      { id: "s1", acceptanceClicksignId: "acc1", acceptanceStatus: "completed" },
    ]);

    const r = await sendVendedorVia("p1", "cron");
    expect(r).toEqual({ ok: false, reason: "already" });
  });
});
