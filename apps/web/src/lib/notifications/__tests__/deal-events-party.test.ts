import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { notifyDealEvent } from "../deal-events";

vi.mock("@/lib/email/client", () => ({
  sendEmail: vi.fn().mockResolvedValue({ id: "email-1", ok: true }),
}));
vi.mock("@/lib/newton/trigger", () => ({
  triggerNewtonForRequest: vi.fn().mockResolvedValue(undefined),
}));
// Default `null` = tenant sem agente nenhum, que é o estado de fábrica.
vi.mock("@/lib/agents/whatsapp-router", () => ({
  resolveWhatsappAgent: vi.fn().mockResolvedValue(null),
  dispatchWhatsappNotify: vi
    .fn()
    .mockResolvedValue({ status: "sent", detail: { via: "max", maxNotifyId: "mx1" } }),
}));
vi.mock("@/lib/newton/whatsapp-window", () => ({
  isWithinWhatsappWindow: vi.fn().mockReturnValue(true),
}));

import { sendEmail } from "@/lib/email/client";
import { triggerNewtonForRequest } from "@/lib/newton/trigger";
import {
  resolveWhatsappAgent,
  dispatchWhatsappNotify,
} from "@/lib/agents/whatsapp-router";
import { isWithinWhatsappWindow } from "@/lib/newton/whatsapp-window";

const dealFind = prisma.deal.findUnique as unknown as ReturnType<typeof vi.fn>;
const orgSettingsFind = prisma.orgNotificationSettings
  .findUnique as unknown as ReturnType<typeof vi.fn>;
const rosterFind = prisma.splitRecipient.findMany as unknown as ReturnType<
  typeof vi.fn
>;
const leaseFind = prisma.leaseContract.findFirst as unknown as ReturnType<
  typeof vi.fn
>;
const payLinkFind = prisma.chargePublicLink.findUnique as unknown as ReturnType<
  typeof vi.fn
>;
const logCreate = prisma.dealNotificationLog.create as unknown as ReturnType<
  typeof vi.fn
>;
const logUpdate = prisma.dealNotificationLog.update as unknown as ReturnType<
  typeof vi.fn
>;
const newtonCreate = prisma.newtonRequest.create as unknown as ReturnType<
  typeof vi.fn
>;

function dealRow(over: Record<string, unknown> = {}) {
  return {
    id: "deal1",
    title: "Venda Apto 302",
    userId: "user1",
    notificationsJson: null,
    pipeline: { orgId: "org1", kind: "venda" },
    stage: { name: "Contrato assinado" },
    form: {
      id: "form1",
      dataJson: {
        vendedores: [
          { nome: "Maria Souza", email: "maria@ex.com", mobile_phone: "11987654321" },
        ],
      },
    },
    ...over,
  };
}

/** Só o público `party` ligado — corretor fora do caminho. */
function partyOnly(channels: { email?: boolean; whatsapp?: boolean }) {
  return {
    settingsJson: {
      events: {
        contract_signed: { broker: { email: false }, party: channels },
        charge_created: { broker: { email: false }, party: channels },
      },
    },
  };
}

/**
 * O template é chamado como função (não JSX), então `react` já é a árvore
 * renderizada — o CTA só aparece varrendo os elementos atrás de um `href`.
 */
function findHref(node: unknown): string | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findHref(child);
      if (hit) return hit;
    }
    return null;
  }
  if (!node || typeof node !== "object") return null;
  const props = (node as { props?: Record<string, unknown> }).props;
  if (!props) return null;
  if (typeof props.href === "string") return props.href;
  return findHref(props.children);
}

function logRowsFor(channel: string) {
  return logCreate.mock.calls
    .map((c) => c[0].data)
    .filter((d: { channel: string }) => d.channel === channel);
}

describe("notifyDealEvent — público party (v2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    orgSettingsFind.mockResolvedValue(null);
    rosterFind.mockResolvedValue([]);
    leaseFind.mockResolvedValue(null);
    payLinkFind.mockResolvedValue(null);
    logCreate.mockResolvedValue({ id: "log1" });
    logUpdate.mockResolvedValue({});
    newtonCreate.mockResolvedValue({ id: "req1" });
    (resolveWhatsappAgent as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValue(null);
    (dispatchWhatsappNotify as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ status: "sent", detail: { via: "max", maxNotifyId: "mx1" } });
    (isWithinWhatsappWindow as unknown as ReturnType<typeof vi.fn>)
      .mockReturnValue(true);
  });

  it("party OFF (default) → nada sai pras partes", async () => {
    dealFind.mockResolvedValue(dealRow());
    await notifyDealEvent({
      dealId: "deal1",
      orgId: "org1",
      event: "contract_signed",
      dedupeKey: "env1",
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("contract_signed com party.email → e-mail à parte, log audience=party", async () => {
    dealFind.mockResolvedValue(dealRow());
    orgSettingsFind.mockResolvedValue(partyOnly({ email: true }));
    await notifyDealEvent({
      dealId: "deal1",
      orgId: "org1",
      event: "contract_signed",
      dedupeKey: "env1",
    });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const emailArgs = (sendEmail as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(emailArgs.to).toBe("maria@ex.com");
    expect(emailArgs.subject).toBe("Contrato assinado");
    expect(logRowsFor("email")[0]).toMatchObject({
      audience: "party",
      recipientKey: "party:maria@ex.com",
      status: "pending",
    });
    expect(logUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "sent" }),
      })
    );
  });

  it("evento fora da allowlist ignora party mesmo com o JSON ligado", async () => {
    dealFind.mockResolvedValue(dealRow());
    orgSettingsFind.mockResolvedValue({
      settingsJson: {
        events: {
          stage_change: { broker: { email: false }, party: { email: true } },
        },
      },
    });
    await notifyDealEvent({
      dealId: "deal1",
      orgId: "org1",
      event: "stage_change",
      dedupeKey: "st1:20260728",
    });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(logCreate).not.toHaveBeenCalled();
  });

  it("charge_created inclui o link público /pay/[token] quando ele JÁ existe", async () => {
    dealFind.mockResolvedValue(dealRow());
    orgSettingsFind.mockResolvedValue(partyOnly({ email: true }));
    payLinkFind.mockResolvedValue({ publicToken: "tok123" });
    await notifyDealEvent({
      dealId: "deal1",
      orgId: "org1",
      event: "charge_created",
      dedupeKey: "chg1",
      context: { extra: { chargeId: "chg1" } },
    });
    expect(payLinkFind).toHaveBeenCalledWith(
      expect.objectContaining({ where: { chargeId: "chg1" } })
    );
    const react = (sendEmail as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][0].react;
    expect(findHref(react)).toContain("/pay/tok123");
  });

  it("charge_created sem link existente NÃO cunha um — e-mail sai sem CTA", async () => {
    dealFind.mockResolvedValue(dealRow());
    orgSettingsFind.mockResolvedValue(partyOnly({ email: true }));
    payLinkFind.mockResolvedValue(null);
    await notifyDealEvent({
      dealId: "deal1",
      orgId: "org1",
      event: "charge_created",
      dedupeKey: "chg1",
      context: { extra: { chargeId: "chg1" } },
    });
    expect(prisma.chargePublicLink.create).not.toHaveBeenCalled();
    const react = (sendEmail as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][0].react;
    expect(findHref(react)).toBeNull();
  });

  it("WhatsApp à parte: tenant SEM Newton vira skipped, sem NewtonRequest", async () => {
    dealFind.mockResolvedValue(dealRow());
    orgSettingsFind.mockResolvedValue(partyOnly({ whatsapp: true }));
    await notifyDealEvent({
      dealId: "deal1",
      orgId: "org1",
      event: "contract_signed",
      dedupeKey: "env1",
    });
    expect(newtonCreate).not.toHaveBeenCalled();
    expect(triggerNewtonForRequest).not.toHaveBeenCalled();
    expect(logUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "skipped",
          detail: { reason: "sem_agente_de_whatsapp_para_a_org" },
        }),
      })
    );
  });

  it("WhatsApp à parte: tenant COM Newton cria NewtonRequest one-shot E dispara o trigger", async () => {
    dealFind.mockResolvedValue(dealRow());
    orgSettingsFind.mockResolvedValue(partyOnly({ whatsapp: true }));
    (resolveWhatsappAgent as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValue("newton");
    await notifyDealEvent({
      dealId: "deal1",
      orgId: "org1",
      event: "contract_signed",
      dedupeKey: "env1",
    });
    expect(resolveWhatsappAgent).toHaveBeenCalledWith("org1", "venda");
    const req = newtonCreate.mock.calls[0][0].data;
    expect(req).toMatchObject({
      orgId: "org1",
      dealId: "deal1",
      createdBy: "user1",
      dedupeTag: "[deal_party_notify][log1]",
      targetType: "contact",
      targetRef: "5511987654321",
      targetLabel: "Maria Souza",
    });
    expect(req.ask).toContain("fulfilled");
    // #193: pedido sem trigger morre no inbox — o gatilho é obrigatório aqui.
    expect(triggerNewtonForRequest).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: "req1", kind: "create" })
    );
    expect(logUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "sent" }),
      })
    );
  });

  /**
   * O caminho da parte no Newton é um NewtonRequest com cobrança e inbox. No
   * Max é aviso direto: os dois eventos liberados pra parte são informativos, a
   * Cloud API não tem inbox de pedido pra alimentar, e o outbox do Max cobre a
   * janela — por isso nem `newtonRequest.create` nem o gate de horário aparecem.
   */
  it("WhatsApp à parte no tenant do Max: aviso direto, sem NewtonRequest", async () => {
    dealFind.mockResolvedValue(dealRow());
    orgSettingsFind.mockResolvedValue(partyOnly({ whatsapp: true }));
    (resolveWhatsappAgent as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValue("max");
    (isWithinWhatsappWindow as unknown as ReturnType<typeof vi.fn>)
      .mockReturnValue(false);

    await notifyDealEvent({
      dealId: "deal1",
      orgId: "org1",
      event: "contract_signed",
      dedupeKey: "env1",
    });

    expect(newtonCreate).not.toHaveBeenCalled();
    expect(triggerNewtonForRequest).not.toHaveBeenCalled();
    expect(dispatchWhatsappNotify).toHaveBeenCalledWith(
      "max",
      expect.objectContaining({
        audience: "deal_party",
        // A linha de log é o chokepoint atômico de idempotência do motor —
        // reusá-la como dedupeKey estende a garantia até dentro do Max.
        dedupeKey: "log1",
      })
    );
    expect(logUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "sent",
          detail: { via: "max", maxNotifyId: "mx1" },
        }),
      })
    );
  });

  it("fora da janela 7h–22h o WhatsApp da parte vira skipped registrado", async () => {
    dealFind.mockResolvedValue(dealRow());
    orgSettingsFind.mockResolvedValue(partyOnly({ whatsapp: true }));
    (resolveWhatsappAgent as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValue("newton");
    (isWithinWhatsappWindow as unknown as ReturnType<typeof vi.fn>)
      .mockReturnValue(false);
    await notifyDealEvent({
      dealId: "deal1",
      orgId: "org1",
      event: "contract_signed",
      dedupeKey: "env1",
    });
    expect(newtonCreate).not.toHaveBeenCalled();
    expect(logUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "skipped",
          detail: { reason: "fora_da_janela_7h_22h" },
        }),
      })
    );
  });

  it("muted silencia também as partes", async () => {
    dealFind.mockResolvedValue(dealRow({ notificationsJson: { muted: true } }));
    orgSettingsFind.mockResolvedValue(partyOnly({ email: true }));
    await notifyDealEvent({
      dealId: "deal1",
      orgId: "org1",
      event: "contract_signed",
      dedupeKey: "env1",
    });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(logCreate).not.toHaveBeenCalled();
  });

  it("a mesma parte repetida no form recebe UMA vez só", async () => {
    dealFind.mockResolvedValue(
      dealRow({
        form: {
          id: "form1",
          dataJson: {
            vendedores: [{ nome: "Maria", email: "maria@ex.com" }],
            compradores: [{ nome: "Maria Souza", email: "maria@ex.com" }],
          },
        },
      })
    );
    orgSettingsFind.mockResolvedValue(partyOnly({ email: true }));
    await notifyDealEvent({
      dealId: "deal1",
      orgId: "org1",
      event: "contract_signed",
      dedupeKey: "env1",
    });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  /**
   * A fusão por contato é agressiva por desenho (duas pessoas que dividem o
   * telefone da família viram uma). Sem rastro, "o comprador não recebeu" era
   * indistinguível de falha de envio.
   */
  it("quem foi fundido no dedupe fica registrado no detail do log", async () => {
    dealFind.mockResolvedValue(
      dealRow({
        form: {
          id: "form1",
          dataJson: {
            vendedores: [{ nome: "Maria Souza", email: "casal@ex.com" }],
            compradores: [{ nome: "José Souza", email: "casal@ex.com" }],
          },
        },
      })
    );
    orgSettingsFind.mockResolvedValue(partyOnly({ email: true }));

    await notifyDealEvent({
      dealId: "deal1",
      orgId: "org1",
      event: "contract_signed",
      dedupeKey: "env1",
    });

    // Comportamento de envio inalterado: UM e-mail.
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(logUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "sent",
          detail: expect.objectContaining({
            droppedParties: [
              {
                nome: "José Souza",
                role: "comprador",
                reason: "email_duplicado",
                mergedInto: "Maria Souza",
              },
            ],
          }),
        }),
      })
    );
  });

  it("sem fusão, o detail do log não ganha `droppedParties`", async () => {
    dealFind.mockResolvedValue(dealRow());
    orgSettingsFind.mockResolvedValue(partyOnly({ email: true }));

    await notifyDealEvent({
      dealId: "deal1",
      orgId: "org1",
      event: "contract_signed",
      dedupeKey: "env1",
    });

    const detail = logUpdate.mock.calls[0][0].data.detail;
    expect(detail.droppedParties).toBeUndefined();
  });
});
