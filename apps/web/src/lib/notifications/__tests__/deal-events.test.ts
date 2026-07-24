import { describe, it, expect, beforeEach, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { notifyDealEvent, stageChangeDedupeKey } from "../deal-events";

vi.mock("@/lib/email/client", () => ({
  sendEmail: vi.fn().mockResolvedValue({ id: "email-1", ok: true }),
}));
vi.mock("@/lib/newton/deal-notify-trigger", () => ({
  triggerNewtonDealNotify: vi.fn().mockResolvedValue("skipped"),
}));

import { sendEmail } from "@/lib/email/client";

const dealFind = prisma.deal.findUnique as unknown as ReturnType<typeof vi.fn>;
const orgSettingsFind = prisma.orgNotificationSettings
  .findUnique as unknown as ReturnType<typeof vi.fn>;
const rosterFind = prisma.splitRecipient.findMany as unknown as ReturnType<
  typeof vi.fn
>;
const notifCreate = prisma.notification.create as unknown as ReturnType<
  typeof vi.fn
>;
const logCreate = prisma.dealNotificationLog.create as unknown as ReturnType<
  typeof vi.fn
>;
const logUpdate = prisma.dealNotificationLog.update as unknown as ReturnType<
  typeof vi.fn
>;

function dealRow(over: Record<string, unknown> = {}) {
  return {
    id: "deal1",
    title: "Venda Apto 302",
    notificationsJson: null,
    pipeline: { orgId: "org1", kind: "venda" },
    stage: { name: "Contrato assinado" },
    form: {
      id: "form1",
      dataJson: { comissao: { comissionados: [{ cpf: "111.222.333-44" }] } },
    },
    ...over,
  };
}

const broker = {
  id: "sr1",
  orgId: "org1",
  label: "Corretor Um",
  cpfCnpj: "11122233344",
  ownerCpfCnpj: null,
  ownerName: null,
  email: "um@x.com",
  phone: null,
  kind: "commissioner",
  active: true,
  pendingFields: [] as string[],
  notifyByEmail: true,
  notifyByWhatsapp: false,
  notifyOptOut: false,
};

describe("notifyDealEvent — motor de fan-out", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    orgSettingsFind.mockResolvedValue(null);
    rosterFind.mockResolvedValue([broker]);
    logCreate.mockResolvedValue({ id: "log1" });
    logUpdate.mockResolvedValue({});
    notifCreate.mockResolvedValue({});
  });

  it("evento OWNS_BELL emite sino + e-mail (claim pending → settle sent)", async () => {
    dealFind.mockResolvedValue(dealRow());
    await notifyDealEvent({
      dealId: "deal1",
      orgId: "org1",
      event: "contract_ready",
      dedupeKey: "c1",
    });
    expect(notifCreate).toHaveBeenCalledTimes(1);
    expect(logCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ channel: "email", status: "pending" }),
      })
    );
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(logUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "sent" }),
      })
    );
  });

  it("contract_signed NÃO emite sino (pertence ao notifyEnvelopeMilestone) mas envia e-mail", async () => {
    dealFind.mockResolvedValue(dealRow());
    await notifyDealEvent({
      dealId: "deal1",
      orgId: "org1",
      event: "contract_signed",
      dedupeKey: "env1",
    });
    expect(notifCreate).not.toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("muted silencia envios externos mas mantém o sino de eventos próprios", async () => {
    dealFind.mockResolvedValue(dealRow({ notificationsJson: { muted: true } }));
    await notifyDealEvent({
      dealId: "deal1",
      orgId: "org1",
      event: "stage_change",
      dedupeKey: "s1:20260724",
    });
    expect(notifCreate).toHaveBeenCalledTimes(1);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(logCreate).not.toHaveBeenCalled();
  });

  it("P2002 no claim do log → não envia e-mail (idempotência)", async () => {
    dealFind.mockResolvedValue(dealRow());
    logCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dup", {
        code: "P2002",
        clientVersion: "5.22.0",
      })
    );
    await notifyDealEvent({
      dealId: "deal1",
      orgId: "org1",
      event: "contract_signed",
      dedupeKey: "env1",
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("cross-org (pipeline.orgId difere) → no-op total", async () => {
    dealFind.mockResolvedValue(dealRow({ pipeline: { orgId: "outra", kind: "venda" } }));
    await notifyDealEvent({
      dealId: "deal1",
      orgId: "org1",
      event: "contract_ready",
      dedupeKey: "c1",
    });
    expect(notifCreate).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("nunca lança mesmo com DB fora", async () => {
    dealFind.mockRejectedValue(new Error("db down"));
    await expect(
      notifyDealEvent({
        dealId: "deal1",
        orgId: "org1",
        event: "charge_paid",
        dedupeKey: "ch1",
      })
    ).resolves.toBeUndefined();
  });
});

describe("stageChangeDedupeKey — bucketing por dia BRT", () => {
  it("23h UTC do dia 10 (20h BRT dia 10) e 01h UTC do dia 11 (22h BRT dia 10) caem no MESMO bucket", () => {
    const a = stageChangeDedupeKey("st1", new Date("2026-07-10T23:00:00Z"));
    const b = stageChangeDedupeKey("st1", new Date("2026-07-11T01:00:00Z"));
    expect(a).toBe("st1:20260710");
    expect(b).toBe("st1:20260710");
  });

  it("vira o bucket às 03h UTC (00h BRT)", () => {
    const c = stageChangeDedupeKey("st1", new Date("2026-07-11T03:00:00Z"));
    expect(c).toBe("st1:20260711");
  });
});
