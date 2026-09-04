import { describe, it, expect, beforeEach, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

vi.mock("@/lib/email/client", () => ({
  sendEmail: vi.fn().mockResolvedValue({ id: "email-1", ok: true }),
}));

import { sendEmail } from "@/lib/email/client";
import {
  isPartnerBrokerKind,
  notifyProposalPartnerBrokers,
} from "../notify-partner-brokers";
import { notifyProposalMilestone } from "../notify-proposal";

const proposalFind = prisma.proposal.findUnique as unknown as ReturnType<typeof vi.fn>;
const rosterFind = prisma.splitRecipient.findMany as unknown as ReturnType<typeof vi.fn>;
const logCreate = prisma.proposalNotificationLog.create as unknown as ReturnType<typeof vi.fn>;
const logUpdate = prisma.proposalNotificationLog.update as unknown as ReturnType<typeof vi.fn>;
const sendEmailMock = sendEmail as unknown as ReturnType<typeof vi.fn>;

function recipient(over: Record<string, unknown> = {}) {
  return {
    id: "sr1",
    orgId: "org1",
    label: "Carla Parceira",
    cpfCnpj: null,
    ownerCpfCnpj: null,
    ownerName: null,
    email: "carla@parceira.com",
    phone: null,
    kind: "commissioner",
    active: true,
    pendingFields: [] as string[],
    notifyByEmail: true,
    notifyByWhatsapp: false,
    notifyOptOut: false,
    archivedAt: null,
    ...over,
  };
}

function proposalRow(over: Record<string, unknown> = {}) {
  return {
    id: "p1",
    orgId: "org1",
    code: "PROP-2026-0001",
    title: "Maria — Rua X",
    kind: "venda",
    dataJson: {
      compradores: [{ nome: "Maria" }],
      imoveis: [{ endereco: "Rua X, 1" }],
      pagamento: { valor_total: 500000 },
      corretores_parceiros: [{ nome: "Carla Parceira", splitRecipientId: "sr1" }],
    },
    ...over,
  };
}

describe("notifyProposalPartnerBrokers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    logCreate.mockResolvedValue({ id: "plog-1" });
    logUpdate.mockResolvedValue({});
    sendEmailMock.mockResolvedValue({ id: "email-1", ok: true });
  });

  it("os três marcos e só eles", () => {
    expect(isPartnerBrokerKind("sent")).toBe(true);
    expect(isPartnerBrokerKind("signed_proponente")).toBe(true);
    expect(isPartnerBrokerKind("completed")).toBe(true);
    expect(isPartnerBrokerKind("delivered")).toBe(false);
    expect(isPartnerBrokerKind("refused")).toBe(false);
  });

  it("manda e-mail ao parceiro casado com o registry e registra o log como sent", async () => {
    proposalFind.mockResolvedValue(proposalRow());
    rosterFind.mockResolvedValue([recipient()]);

    const out = await notifyProposalPartnerBrokers({ proposalId: "p1", orgId: "org1", kind: "sent" });

    expect(out).toEqual({ sent: 1, skipped: 0, failed: 0 });
    expect(logCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        proposalId: "p1",
        orgId: "org1",
        kind: "sent",
        channel: "email",
        recipientKey: "sr1",
        status: "pending",
      }),
    });
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const call = sendEmailMock.mock.calls[0][0];
    expect(call.to).toBe("carla@parceira.com");
    expect(call.subject).toContain("PROP-2026-0001");
    expect(call.orgId).toBe("org1");
    expect(logUpdate).toHaveBeenCalledWith({
      where: { id: "plog-1" },
      data: { status: "sent", detail: { emailId: "email-1" } },
    });
  });

  it("locação: mesma chave corretores_parceiros", async () => {
    proposalFind.mockResolvedValue(
      proposalRow({
        kind: "locacao",
        dataJson: {
          locatarios: [{ nome: "Maria" }],
          corretores_parceiros: [{ nome: "Carla Parceira", splitRecipientId: "sr1" }],
        },
      })
    );
    rosterFind.mockResolvedValue([recipient()]);
    const out = await notifyProposalPartnerBrokers({ proposalId: "p1", orgId: "org1", kind: "completed" });
    expect(out.sent).toBe(1);
  });

  it("pula quem desligou e-mail, quem não tem e-mail e quem deu opt-out", async () => {
    proposalFind.mockResolvedValue(
      proposalRow({
        dataJson: {
          corretores_parceiros: [
            { nome: "A", splitRecipientId: "a" },
            { nome: "B", splitRecipientId: "b" },
            { nome: "C", splitRecipientId: "c" },
          ],
        },
      })
    );
    rosterFind.mockResolvedValue([
      recipient({ id: "a", label: "A", notifyByEmail: false }),
      recipient({ id: "b", label: "B", email: null }),
      recipient({ id: "c", label: "C", notifyOptOut: true }),
    ]);
    const out = await notifyProposalPartnerBrokers({ proposalId: "p1", orgId: "org1", kind: "sent" });
    expect(sendEmailMock).not.toHaveBeenCalled();
    // a e b chegam ao resolver e são pulados aqui; c nem sai do resolver (opt-out).
    expect(out).toEqual({ sent: 0, skipped: 2, failed: 0 });
  });

  it("dedupe: P2002 no log = já enviado, sem segundo e-mail", async () => {
    proposalFind.mockResolvedValue(proposalRow());
    rosterFind.mockResolvedValue([recipient()]);
    logCreate.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" })
    );
    const out = await notifyProposalPartnerBrokers({ proposalId: "p1", orgId: "org1", kind: "completed" });
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(out).toEqual({ sent: 0, skipped: 1, failed: 0 });
  });

  it("falha de envio vira log failed, não exceção", async () => {
    proposalFind.mockResolvedValue(proposalRow());
    rosterFind.mockResolvedValue([recipient()]);
    sendEmailMock.mockResolvedValueOnce({ ok: false, error: "smtp down" });
    const out = await notifyProposalPartnerBrokers({ proposalId: "p1", orgId: "org1", kind: "sent" });
    expect(out).toEqual({ sent: 0, skipped: 0, failed: 1 });
    expect(logUpdate).toHaveBeenCalledWith({
      where: { id: "plog-1" },
      data: { status: "failed", detail: { error: "smtp down" } },
    });
  });

  it("proposta de outra org ou inexistente: nada", async () => {
    proposalFind.mockResolvedValue(proposalRow({ orgId: "org2" }));
    const out = await notifyProposalPartnerBrokers({ proposalId: "p1", orgId: "org1", kind: "sent" });
    expect(out).toEqual({ sent: 0, skipped: 0, failed: 0 });
    expect(rosterFind).not.toHaveBeenCalled();
  });
});

describe("notifyProposalMilestone × parceiros", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    logCreate.mockResolvedValue({ id: "plog-1" });
    sendEmailMock.mockResolvedValue({ id: "email-1", ok: true });
  });

  it("`sent` manda e-mail aos parceiros e NÃO toca o sino do dono", async () => {
    proposalFind.mockResolvedValue(proposalRow());
    rosterFind.mockResolvedValue([recipient()]);
    const notifCreate = prisma.notification.create as unknown as ReturnType<typeof vi.fn>;
    const memberFind = prisma.orgMembership.findFirst as unknown as ReturnType<typeof vi.fn>;

    await notifyProposalMilestone({ proposalId: "p1", orgId: "org1", userId: "u1", kind: "sent" });

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(memberFind).not.toHaveBeenCalled();
    expect(notifCreate).not.toHaveBeenCalled();
  });

  it("`completed` manda e-mail aos parceiros E segue para o sino", async () => {
    proposalFind.mockResolvedValue(proposalRow());
    rosterFind.mockResolvedValue([recipient()]);
    const memberFind = prisma.orgMembership.findFirst as unknown as ReturnType<typeof vi.fn>;
    memberFind.mockResolvedValue({ id: "m1" });

    await notifyProposalMilestone({ proposalId: "p1", orgId: "org1", userId: "u1", kind: "completed" });

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(memberFind).toHaveBeenCalled();
  });
});
