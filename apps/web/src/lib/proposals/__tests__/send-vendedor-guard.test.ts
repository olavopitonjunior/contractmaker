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

  it("instrument=aceite → falha visível (paridade chega no PR 2.5)", async () => {
    propFind.mockResolvedValueOnce({ instrument: "aceite" });
    const r = await sendVendedorVia("p1", "webhook");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("error");
    expect(eventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventName: "chained_aceite2_failed" }),
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
