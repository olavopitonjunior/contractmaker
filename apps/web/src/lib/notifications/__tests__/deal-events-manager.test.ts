import { describe, it, expect, beforeEach, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { notifyDealEvent } from "../deal-events";
import { DEAL_NOTIF_EVENTS } from "../deal-events-shared";

vi.mock("@/lib/email/client", () => ({
  sendEmail: vi.fn().mockResolvedValue({ id: "email-1", ok: true }),
}));
vi.mock("@/lib/newton/deal-notify-trigger", () => ({
  triggerNewtonDealNotify: vi.fn().mockResolvedValue("skipped"),
}));
vi.mock("@/lib/newton/notify-trigger", () => ({
  triggerNewtonNotify: vi.fn().mockResolvedValue("sent"),
}));
vi.mock("@/lib/newton/gate", () => ({
  isNewtonEnabledForDeal: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/newton/whatsapp-window", () => ({
  isWithinWhatsappWindow: vi.fn().mockReturnValue(true),
}));

import { sendEmail } from "@/lib/email/client";
import { triggerNewtonNotify } from "@/lib/newton/notify-trigger";
import { isNewtonEnabledForDeal } from "@/lib/newton/gate";
import { isWithinWhatsappWindow } from "@/lib/newton/whatsapp-window";

const dealFind = prisma.deal.findUnique as unknown as ReturnType<typeof vi.fn>;
const orgSettingsFind = prisma.orgNotificationSettings
  .findUnique as unknown as ReturnType<typeof vi.fn>;
const rosterFind = prisma.splitRecipient.findMany as unknown as ReturnType<
  typeof vi.fn
>;
const membershipFirst = prisma.orgMembership.findFirst as unknown as ReturnType<
  typeof vi.fn
>;
const logCreate = prisma.dealNotificationLog.create as unknown as ReturnType<
  typeof vi.fn
>;
const logUpdate = prisma.dealNotificationLog.update as unknown as ReturnType<
  typeof vi.fn
>;
const notifCreate = prisma.notification.create as unknown as ReturnType<
  typeof vi.fn
>;
const trigger = triggerNewtonNotify as unknown as ReturnType<typeof vi.fn>;
const newtonGate = isNewtonEnabledForDeal as unknown as ReturnType<typeof vi.fn>;
const window7a22 = isWithinWhatsappWindow as unknown as ReturnType<typeof vi.fn>;

function dealRow(over: Record<string, unknown> = {}) {
  return {
    id: "deal1",
    title: "Venda Apto 302",
    userId: "user1",
    managerUserId: "u-ger",
    notificationsJson: null,
    pipeline: { orgId: "org1", kind: "venda" },
    stage: { name: "Contrato assinado" },
    form: { id: "form1", dataJson: {} },
    ...over,
  };
}

function membership(over: Record<string, unknown> = {}) {
  return {
    userId: "u-ger",
    user: {
      name: "Marcia Gerente",
      email: "marcia@imob.com",
      phone: "+5511987654321",
      deletedAt: null,
    },
    ...over,
  };
}

function logRowsFor(channel: string) {
  return logCreate.mock.calls
    .map((c) => c[0].data)
    .filter((d: { channel: string }) => d.channel === channel);
}

describe("notifyDealEvent — público manager (v3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    orgSettingsFind.mockResolvedValue(null);
    // Corretor fora do caminho: sem roster, o fan-out de broker não envia nada.
    rosterFind.mockResolvedValue([]);
    membershipFirst.mockResolvedValue(membership());
    logCreate.mockResolvedValue({ id: "log1" });
    logUpdate.mockResolvedValue({});
    notifCreate.mockResolvedValue({});
    trigger.mockResolvedValue("sent");
    newtonGate.mockResolvedValue(true);
    window7a22.mockReturnValue(true);
  });

  it("default LIGADO: gerente com contato recebe e-mail E WhatsApp sem configurar nada", async () => {
    dealFind.mockResolvedValue(dealRow());

    await notifyDealEvent({
      dealId: "deal1",
      orgId: "org1",
      event: "contract_ready",
      dedupeKey: "c1",
    });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const emailArgs = (sendEmail as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(emailArgs.to).toBe("marcia@imob.com");
    expect(emailArgs.subject).toBe("Contrato pronto — Venda Apto 302");
    expect(emailArgs.tags).toContainEqual({
      name: "kind",
      value: "deal-notify-manager",
    });

    expect(trigger).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveBeenCalledWith(
      expect.objectContaining({
        audience: "platform_user",
        orgId: "org1",
        dealId: "deal1",
        // E.164 COM "+" — a normalização pro sidecar é do trigger.
        phone: "+5511987654321",
        recipientName: "Marcia Gerente",
      })
    );
  });

  /**
   * A unique do DealNotificationLog é (dealId, event, channel, recipientKey,
   * dedupeKey) — SEM audience. Sem o prefixo, um gerente cujo userId batesse
   * com um splitRecipientId perderia um dos dois envios em silêncio.
   */
  it("recipientKey leva o prefixo manager: e o log marca audience", async () => {
    dealFind.mockResolvedValue(dealRow());

    await notifyDealEvent({
      dealId: "deal1",
      orgId: "org1",
      event: "stage_change",
      dedupeKey: "st1:20260730",
    });

    expect(logRowsFor("email")[0]).toMatchObject({
      audience: "manager",
      recipientKey: "manager:u-ger",
      recipientLabel: "Marcia Gerente",
      status: "pending",
    });
    expect(logRowsFor("whatsapp")[0]).toMatchObject({
      audience: "manager",
      recipientKey: "manager:u-ger",
    });
    expect(logUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "sent" }),
      })
    );
  });

  it("sem telefone no perfil → só e-mail, sem linha de WhatsApp", async () => {
    dealFind.mockResolvedValue(dealRow());
    membershipFirst.mockResolvedValue(
      membership({
        user: {
          name: "Marcia Gerente",
          email: "marcia@imob.com",
          phone: null,
          deletedAt: null,
        },
      })
    );

    await notifyDealEvent({
      dealId: "deal1",
      orgId: "org1",
      event: "contract_ready",
      dedupeKey: "c1",
    });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(trigger).not.toHaveBeenCalled();
    expect(logRowsFor("whatsapp")).toHaveLength(0);
  });

  it("label cai no e-mail quando o gerente não tem nome cadastrado", async () => {
    dealFind.mockResolvedValue(dealRow());
    membershipFirst.mockResolvedValue(
      membership({
        user: {
          name: "   ",
          email: "marcia@imob.com",
          phone: null,
          deletedAt: null,
        },
      })
    );

    await notifyDealEvent({
      dealId: "deal1",
      orgId: "org1",
      event: "contract_ready",
      dedupeKey: "c1",
    });

    expect(logRowsFor("email")[0].recipientLabel).toBe("marcia@imob.com");
  });

  it("tenant SEM Newton: WhatsApp vira skipped registrado (e-mail segue)", async () => {
    dealFind.mockResolvedValue(dealRow());
    newtonGate.mockResolvedValue(false);

    await notifyDealEvent({
      dealId: "deal1",
      orgId: "org1",
      event: "contract_ready",
      dedupeKey: "c1",
    });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(trigger).not.toHaveBeenCalled();
    expect(logUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "skipped",
          detail: { reason: "newton_off_para_a_org" },
        }),
      })
    );
  });

  it("fora da janela 7h–22h o WhatsApp vira skipped registrado", async () => {
    dealFind.mockResolvedValue(dealRow());
    window7a22.mockReturnValue(false);

    await notifyDealEvent({
      dealId: "deal1",
      orgId: "org1",
      event: "contract_ready",
      dedupeKey: "c1",
    });

    expect(trigger).not.toHaveBeenCalled();
    expect(logUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "skipped",
          detail: { reason: "fora_da_janela_7h_22h" },
        }),
      })
    );
  });

  it("sidecar ausente (trigger devolve skipped) assenta skipped, não sent", async () => {
    dealFind.mockResolvedValue(dealRow());
    trigger.mockResolvedValue("skipped");

    await notifyDealEvent({
      dealId: "deal1",
      orgId: "org1",
      event: "contract_ready",
      dedupeKey: "c1",
    });

    expect(logUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "skipped",
          detail: { reason: "newton_gate_off_ou_sidecar_ausente" },
        }),
      })
    );
  });

  it("org desliga o gerente na matriz → nada sai", async () => {
    dealFind.mockResolvedValue(dealRow());
    orgSettingsFind.mockResolvedValue({
      settingsJson: {
        events: {
          contract_ready: { manager: { email: false, whatsapp: false } },
        },
      },
    });

    await notifyDealEvent({
      dealId: "deal1",
      orgId: "org1",
      event: "contract_ready",
      dedupeKey: "c1",
    });

    expect(sendEmail).not.toHaveBeenCalled();
    expect(trigger).not.toHaveBeenCalled();
    expect(logCreate).not.toHaveBeenCalled();
  });

  it("desligar um canal preserva o outro (merge por canal)", async () => {
    dealFind.mockResolvedValue(dealRow());
    orgSettingsFind.mockResolvedValue({
      settingsJson: {
        events: { contract_ready: { manager: { whatsapp: false } } },
      },
    });

    await notifyDealEvent({
      dealId: "deal1",
      orgId: "org1",
      event: "contract_ready",
      dedupeKey: "c1",
    });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(trigger).not.toHaveBeenCalled();
  });

  it("muted silencia também o gerente, mas o sino do evento continua", async () => {
    dealFind.mockResolvedValue(dealRow({ notificationsJson: { muted: true } }));

    await notifyDealEvent({
      dealId: "deal1",
      orgId: "org1",
      event: "contract_ready",
      dedupeKey: "c1",
    });

    // O sino continua: a row org-wide + o fan-out `:mgr` direcionado ao
    // gerente (bell-only; o externo dele é o que o `muted` corta).
    expect(notifCreate).toHaveBeenCalledTimes(2);
    expect(notifCreate.mock.calls[1][0].data).toMatchObject({
      userId: "u-ger",
    });
    expect(String(notifCreate.mock.calls[1][0].data.batchId)).toMatch(/:mgr$/);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(trigger).not.toHaveBeenCalled();
    expect(logCreate).not.toHaveBeenCalled();
  });

  it("P2002 no claim → não reenvia (idempotência)", async () => {
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
      event: "contract_ready",
      dedupeKey: "c1",
    });

    expect(sendEmail).not.toHaveBeenCalled();
    expect(trigger).not.toHaveBeenCalled();
    expect(logUpdate).not.toHaveBeenCalled();
  });

  it("negócio sem gerente atribuído é no-op — nem consulta membership", async () => {
    dealFind.mockResolvedValue(dealRow({ managerUserId: null }));

    await notifyDealEvent({
      dealId: "deal1",
      orgId: "org1",
      event: "contract_ready",
      dedupeKey: "c1",
    });

    expect(membershipFirst).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(logCreate).not.toHaveBeenCalled();
  });

  it("ex-membro da org não recebe, mesmo o deal ainda apontando pra ele", async () => {
    dealFind.mockResolvedValue(dealRow());
    membershipFirst.mockResolvedValue(null); // saiu da imobiliária

    await notifyDealEvent({
      dealId: "deal1",
      orgId: "org1",
      event: "contract_ready",
      dedupeKey: "c1",
    });

    expect(membershipFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orgId: "org1", userId: "u-ger" },
      })
    );
    expect(sendEmail).not.toHaveBeenCalled();
    expect(logCreate).not.toHaveBeenCalled();
  });

  it("conta com soft-delete (LGPD) não recebe", async () => {
    dealFind.mockResolvedValue(dealRow());
    membershipFirst.mockResolvedValue(
      membership({
        user: {
          name: "Marcia",
          email: "marcia@imob.com",
          phone: "+5511987654321",
          deletedAt: new Date(),
        },
      })
    );

    await notifyDealEvent({
      dealId: "deal1",
      orgId: "org1",
      event: "contract_ready",
      dedupeKey: "c1",
    });

    expect(sendEmail).not.toHaveBeenCalled();
    expect(logCreate).not.toHaveBeenCalled();
  });

  it("erro ao resolver o gerente não derruba o resto do motor", async () => {
    dealFind.mockResolvedValue(dealRow());
    membershipFirst.mockRejectedValue(new Error("db fora"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      notifyDealEvent({
        dealId: "deal1",
        orgId: "org1",
        event: "contract_ready",
        dedupeKey: "c1",
      })
    ).resolves.toBeUndefined();

    expect(sendEmail).not.toHaveBeenCalled();
    // O sino do evento saiu do mesmo jeito (row org-wide + fan-out `:mgr`).
    expect(notifCreate).toHaveBeenCalledTimes(2);
    err.mockRestore();
  });

  /**
   * Ao contrário da parte, o gerente NÃO tem allowlist: ele é operador da
   * esteira e o vocabulário interno ("contrato pronto") é o dele.
   */
  it("alcança os 8 marcos do negócio, sem allowlist", async () => {
    dealFind.mockResolvedValue(dealRow());

    for (const ev of DEAL_NOTIF_EVENTS) {
      vi.clearAllMocks();
      dealFind.mockResolvedValue(dealRow());
      orgSettingsFind.mockResolvedValue(null);
      rosterFind.mockResolvedValue([]);
      membershipFirst.mockResolvedValue(membership());
      logCreate.mockResolvedValue({ id: "log1" });
      logUpdate.mockResolvedValue({});
      notifCreate.mockResolvedValue({});
      trigger.mockResolvedValue("sent");

      await notifyDealEvent({
        dealId: "deal1",
        orgId: "org1",
        event: ev,
        dedupeKey: `k-${ev}`,
      });

      expect(sendEmail, `evento ${ev}`).toHaveBeenCalledTimes(1);
      expect(trigger, `evento ${ev}`).toHaveBeenCalledTimes(1);
    }
  });
});
