import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { dispatchUserNotification, sweepUserNotifications } from "../user-channels";

// O seam é o ROTEADOR, não um agente: este canal não sabe (nem deve saber) se
// quem entrega é o Newton ou o Max.
vi.mock("@/lib/agents/whatsapp-router", () => ({
  resolveWhatsappAgent: vi.fn().mockResolvedValue("newton"),
  dispatchWhatsappNotify: vi
    .fn()
    .mockResolvedValue({ status: "sent", detail: { via: "newton_sidecar" } }),
}));

import {
  resolveWhatsappAgent,
  dispatchWhatsappNotify,
} from "@/lib/agents/whatsapp-router";

const dispatch = dispatchWhatsappNotify as unknown as ReturnType<typeof vi.fn>;
const resolveAgent = resolveWhatsappAgent as unknown as ReturnType<typeof vi.fn>;
const SENT = { status: "sent", detail: { via: "newton_sidecar" } } as const;
const notifFind = prisma.notification.findUnique as unknown as ReturnType<typeof vi.fn>;
const notifMany = prisma.notification.findMany as unknown as ReturnType<typeof vi.fn>;
const membershipMany = prisma.orgMembership.findMany as unknown as ReturnType<typeof vi.fn>;
const dealFind = prisma.deal.findUnique as unknown as ReturnType<typeof vi.fn>;
const orgFind = prisma.organization.findUnique as unknown as ReturnType<typeof vi.fn>;
const orgSettings = prisma.orgNotificationSettings.findUnique as unknown as ReturnType<typeof vi.fn>;
const prefMany = prisma.userNotificationPreference.findMany as unknown as ReturnType<typeof vi.fn>;
const delivCreate = prisma.userNotificationDelivery.create as unknown as ReturnType<typeof vi.fn>;
const delivUpdate = prisma.userNotificationDelivery.update as unknown as ReturnType<typeof vi.fn>;
const delivCount = prisma.userNotificationDelivery.count as unknown as ReturnType<typeof vi.fn>;
const delivMany = prisma.userNotificationDelivery.findMany as unknown as ReturnType<typeof vi.fn>;
const delivUpdateMany = prisma.userNotificationDelivery.updateMany as unknown as ReturnType<typeof vi.fn>;
const delivFindUnique = prisma.userNotificationDelivery.findUnique as unknown as ReturnType<typeof vi.fn>;

function notifRow(over: Record<string, unknown> = {}) {
  return {
    id: "notif1",
    orgId: "org1",
    userId: "user1",
    type: "form_completed",
    title: "Formulário concluído",
    body: 'O formulário do negócio "Venda Apto 302" foi preenchido até o fim.',
    linkUrl: "/deals/deal1",
    metadata: { dealId: "deal1" },
    ...over,
  };
}

/** Membro com telefone — o que loadEligible espera. */
function member(userId: string, over: Record<string, unknown> = {}) {
  return {
    userId,
    user: { name: `Nome ${userId}`, phone: "+5511987654321", deletedAt: null },
    ...over,
  };
}

/** Preferência com opt-in válido na categoria. */
function pref(userId: string, category = "deal_updates", over: Record<string, unknown> = {}) {
  return {
    userId,
    settingsJson: { events: { [category]: { whatsapp: true } } },
    whatsappOptInAt: new Date("2026-07-01T12:00:00Z"),
    ...over,
  };
}

describe("dispatchUserNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 15h UTC = 12h em São Paulo — dentro da janela 7h–22h. Sem isto a suíte
    // quebraria quando rodasse de madrugada.
    vi.useFakeTimers({ now: new Date("2026-07-24T15:00:00Z"), toFake: ["Date"] });

    notifFind.mockResolvedValue(notifRow());
    membershipMany.mockResolvedValue([member("user1")]);
    dealFind.mockResolvedValue({ userId: "user1", pipeline: { orgId: "org1" } });
    orgFind.mockResolvedValue({ name: "Imobiliária Teste" });
    orgSettings.mockResolvedValue(null);
    prefMany.mockResolvedValue([pref("user1")]);
    delivCreate.mockResolvedValue({ id: "d1" });
    delivUpdate.mockResolvedValue({});
    delivCount.mockResolvedValue(0);
    delivMany.mockResolvedValue([]);
    delivUpdateMany.mockResolvedValue({ count: 0 });
    delivFindUnique.mockResolvedValue(null);
    resolveAgent.mockResolvedValue("newton");
    dispatch.mockResolvedValue(SENT);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("envia quando há opt-in com consentimento datado", async () => {
    const r = await dispatchUserNotification({ notificationId: "notif1" });

    expect(r.sent).toBe(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(
      "newton",
      expect.objectContaining({
        audience: "platform_user",
        orgId: "org1",
        phone: "+5511987654321",
        orgName: "Imobiliária Teste",
        // Título e corpo viajam SEPARADOS — o Max precisa deles como variáveis
        // distintas de template; quem compõe a frase única é o roteador.
        title: "Formulário concluído",
        dedupeKey: "d1",
      })
    );
    // Claim nasce "pending" e é assentado depois — nunca cria já como "sent".
    expect(delivCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "pending", dedupeKey: "n:notif1" }),
      })
    );
    expect(delivUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "sent" }) })
    );
  });

  it("não envia sem preferência nenhuma (default é opt-out)", async () => {
    prefMany.mockResolvedValue([]);

    const r = await dispatchUserNotification({ notificationId: "notif1" });

    expect(r.sent).toBe(0);
    expect(dispatch).not.toHaveBeenCalled();
    expect(delivCreate).not.toHaveBeenCalled();
  });

  it("não envia com toggle ligado mas sem whatsappOptInAt", async () => {
    prefMany.mockResolvedValue([pref("user1", "deal_updates", { whatsappOptInAt: null })]);

    const r = await dispatchUserNotification({ notificationId: "notif1" });

    expect(r.sent).toBe(0);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("respeita o kill switch global da org mesmo com opt-in", async () => {
    orgSettings.mockResolvedValue({ settingsJson: { userChannels: { enabled: false } } });

    const r = await dispatchUserNotification({ notificationId: "notif1" });

    expect(r.sent).toBe(0);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("respeita o kill switch por categoria", async () => {
    orgSettings.mockResolvedValue({
      settingsJson: { userChannels: { events: { deal_updates: false } } },
    });

    const r = await dispatchUserNotification({ notificationId: "notif1" });

    expect(r.sent).toBe(0);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("não dispara duas vezes: P2002 no claim é dedupe", async () => {
    delivCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dup", {
        code: "P2002",
        clientVersion: "5.22.0",
      })
    );

    const r = await dispatchUserNotification({ notificationId: "notif1" });

    expect(r.sent).toBe(0);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("tipo fora da allowlist é no-op total", async () => {
    notifFind.mockResolvedValue(notifRow({ type: "survey_response" }));

    const r = await dispatchUserNotification({ notificationId: "notif1" });

    expect(r).toEqual({ sent: 0, skipped: 0, deferred: 0, failed: 0 });
    expect(delivCreate).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("fora da janela 7h-22h fica deferred, sem claim", async () => {
    // 06h UTC = 03h em São Paulo.
    vi.setSystemTime(new Date("2026-07-24T06:00:00Z"));

    const r = await dispatchUserNotification({ notificationId: "notif1" });

    expect(r.deferred).toBe(1);
    expect(r.sent).toBe(0);
    expect(delivCreate).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("rate cap adia (deferred), não descarta — a capacidade da hora se renova", async () => {
    delivCount.mockResolvedValue(6);

    const r = await dispatchUserNotification({ notificationId: "notif1" });

    expect(r.deferred).toBe(1);
    expect(r.skipped).toBe(0);
    expect(dispatch).not.toHaveBeenCalled();
    expect(delivUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "deferred",
          detail: { reason: "rate_cap" },
        }),
      })
    );
  });

  it("retoma entrega que ficou deferred (claim reivindicável)", async () => {
    // Já existe linha → P2002 no create; o CAS devolve count 1.
    delivCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dup", {
        code: "P2002",
        clientVersion: "5.22.0",
      })
    );
    delivFindUnique.mockResolvedValue({ id: "d-old", status: "deferred" });
    delivUpdateMany.mockResolvedValue({ count: 1 });

    const r = await dispatchUserNotification({ notificationId: "notif1" });

    expect(r.sent).toBe(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
    // O CAS põe o status no where — duas execuções não reivindicam a mesma.
    const where = delivUpdateMany.mock.calls[0][0].where;
    expect(where.id).toBe("d-old");
    expect(where.OR).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: { in: ["deferred", "failed"] } }),
      ])
    );
  });

  it("NÃO retoma entrega já concluída (sent é terminal)", async () => {
    delivCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dup", {
        code: "P2002",
        clientVersion: "5.22.0",
      })
    );
    delivFindUnique.mockResolvedValue({ id: "d-old", status: "sent" });
    // O CAS não casa com status terminal.
    delivUpdateMany.mockResolvedValue({ count: 0 });

    const r = await dispatchUserNotification({ notificationId: "notif1" });

    expect(r.sent).toBe(0);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("perde a corrida do CAS não envia (outra execução reivindicou)", async () => {
    delivCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dup", {
        code: "P2002",
        clientVersion: "5.22.0",
      })
    );
    delivFindUnique.mockResolvedValue({ id: "d-old", status: "deferred" });
    delivUpdateMany.mockResolvedValue({ count: 0 });

    const r = await dispatchUserNotification({ notificationId: "notif1" });

    expect(dispatch).not.toHaveBeenCalled();
    expect(r.sent).toBe(0);
  });

  it("agente indisponível assenta skipped, não sent", async () => {
    dispatch.mockResolvedValue({
      status: "skipped",
      reason: "newton_gate_off_ou_sidecar_ausente",
    });

    const r = await dispatchUserNotification({ notificationId: "notif1" });

    expect(r.skipped).toBe(1);
    expect(delivUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "skipped",
          detail: { reason: "newton_gate_off_ou_sidecar_ausente" },
        }),
      })
    );
  });

  it("tenant sem NENHUM agente nem chega a despachar", async () => {
    resolveAgent.mockResolvedValue(null);

    const r = await dispatchUserNotification({ notificationId: "notif1" });

    expect(r.skipped).toBe(1);
    expect(dispatch).not.toHaveBeenCalled();
    expect(delivUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "skipped",
          detail: { reason: "sem_agente_de_whatsapp_para_a_org" },
        }),
      })
    );
  });

  /**
   * Falha de rede pro serviço do agente é RE-TENTÁVEL: o sweep retoma `failed`.
   * Assentar como `skipped` (terminal) perderia a notificação em silêncio — foi
   * exatamente esse o bug crítico do canal quando todo claim era tratado como
   * terminal.
   */
  it("falha de transporte assenta failed (re-tentável), não skipped", async () => {
    dispatch.mockResolvedValue({ status: "failed", error: "timeout após 3000ms" });

    const r = await dispatchUserNotification({ notificationId: "notif1" });

    expect(r.sent).toBe(0);
    expect(r.skipped).toBe(0);
    // Contado: sem este bucket, uma rajada de falha apareceria no log do cron
    // como "nada aconteceu" — todos os totais em zero.
    expect(r.failed).toBe(1);
    expect(delivUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "failed",
          detail: { error: "timeout após 3000ms" },
        }),
      })
    );
  });

  it("no tenant do Max o despacho vai pro Max, sem tocar no Newton", async () => {
    resolveAgent.mockResolvedValue("max");
    dispatch.mockResolvedValue({
      status: "sent",
      detail: { via: "max", maxNotifyId: "mx1" },
    });

    const r = await dispatchUserNotification({ notificationId: "notif1" });

    expect(r.sent).toBe(1);
    expect(dispatch).toHaveBeenCalledWith("max", expect.anything());
    expect(delivUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "sent",
          detail: { via: "max", maxNotifyId: "mx1" },
        }),
      })
    );
  });

  it("usuário sem telefone não recebe", async () => {
    membershipMany.mockResolvedValue([
      member("user1", { user: { name: "X", phone: null, deletedAt: null } }),
    ]);

    const r = await dispatchUserNotification({ notificationId: "notif1" });

    expect(r.sent).toBe(0);
    expect(dispatch).not.toHaveBeenCalled();
  });

  /**
   * O fan-out `:mgr` de emitNotification existe só pro SINO do gerente (a
   * leitura dele é restrita a rows direcionadas). O canal externo dele sai
   * pelo motor lib/notifications/deal-events.ts, público `manager` — sem este
   * skip ele receberia tudo em duplicata, por dois trilhos cujos dedupes
   * (UserNotificationDelivery vs DealNotificationLog) não se enxergam.
   */
  it("row bell-only do gerente (batchId :mgr) é pulada — o externo vem do motor", async () => {
    notifFind.mockResolvedValue(
      notifRow({ userId: "gerente", batchId: "form1:mgr" })
    );

    const r = await dispatchUserNotification({ notificationId: "notif1" });

    expect(r).toEqual({ sent: 0, skipped: 0, deferred: 0, failed: 0 });
    // Pula ANTES de resolver destinatários: nada de claim pra envio que não sai.
    expect(membershipMany).not.toHaveBeenCalled();
    expect(delivCreate).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("batchId normal (sem :mgr) continua despachando", async () => {
    notifFind.mockResolvedValue(notifRow({ batchId: "form1" }));

    const r = await dispatchUserNotification({ notificationId: "notif1" });

    expect(r.sent).toBe(1);
  });

  it("notificação inexistente é no-op", async () => {
    notifFind.mockResolvedValue(null);

    const r = await dispatchUserNotification({ notificationId: "sumiu" });

    expect(r).toEqual({ sent: 0, skipped: 0, deferred: 0, failed: 0 });
  });
});

describe("sweepUserNotifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ now: new Date("2026-07-24T15:00:00Z"), toFake: ["Date"] });
    membershipMany.mockResolvedValue([member("user1")]);
    dealFind.mockResolvedValue({ userId: "user1", pipeline: { orgId: "org1" } });
    orgFind.mockResolvedValue({ name: "Imobiliária Teste" });
    orgSettings.mockResolvedValue(null);
    prefMany.mockResolvedValue([pref("user1")]);
    delivCreate.mockResolvedValue({ id: "d1" });
    delivUpdate.mockResolvedValue({});
    delivCount.mockResolvedValue(0);
    delivMany.mockResolvedValue([]);
    delivUpdateMany.mockResolvedValue({ count: 0 });
    delivFindUnique.mockResolvedValue(null);
    resolveAgent.mockResolvedValue("newton");
    dispatch.mockResolvedValue(SENT);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("varre só os tipos da allowlist e despacha cada um", async () => {
    notifMany.mockResolvedValue([notifRow(), notifRow({ id: "notif2" })]);

    const r = await sweepUserNotifications();

    expect(r.scanned).toBe(2);
    expect(r.sent).toBe(2);
    const where = notifMany.mock.calls[0][0].where;
    expect(where.type.in).toContain("form_completed");
    expect(where.type.in).not.toContain("survey_response");
    expect(where.createdAt.gte).toBeInstanceOf(Date);
  });

  /**
   * O sweep varre de madrugada; quem decide a janela é o destinatário. Antes
   * havia um corte no topo que economizava a query — e que segurava também o
   * e-mail, contra a regra por destinatário, e o Max, que tem fila própria.
   */
  it("de madrugada varre, mas adia o WhatsApp do tenant do Newton sem claim", async () => {
    vi.setSystemTime(new Date("2026-07-24T06:00:00Z")); // 03h em São Paulo
    notifMany.mockResolvedValue([notifRow()]);

    const r = await sweepUserNotifications();

    expect(notifMany).toHaveBeenCalled();
    expect(r.scanned).toBe(1);
    expect(r.deferred).toBe(1);
    expect(r.sent).toBe(0);
    // Adiado ANTES do claim: a linha não é criada, então nada fica preso.
    expect(delivCreate).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  /**
   * Paridade com o motor de deal-events: o Max recebe a qualquer hora e o
   * outbox DELE agenda a entrega. Segurar aqui só adiaria o handoff.
   */
  it("de madrugada o tenant do Max entrega na hora", async () => {
    vi.setSystemTime(new Date("2026-07-24T06:00:00Z"));
    resolveAgent.mockResolvedValue("max");
    dispatch.mockResolvedValue({ status: "sent", detail: { via: "max" } });
    notifMany.mockResolvedValue([notifRow()]);

    const r = await sweepUserNotifications();

    expect(r.sent).toBe(1);
    expect(r.deferred).toBe(0);
    expect(dispatch).toHaveBeenCalledWith("max", expect.anything());
  });

  it("erro de query não propaga", async () => {
    notifMany.mockRejectedValue(new Error("db caiu"));

    await expect(sweepUserNotifications()).resolves.toMatchObject({
      scanned: 0,
      sent: 0,
    });
  });

  /**
   * Regressão do gap noturno: o canal dorme das 22h às 7h. Com lookback fixo
   * de 30 min, tudo que nascia durante a noite nunca entrava em query alguma
   * — o sweep das 7h já não alcançava a notificação das 22h05.
   */
  it("às 7h o lookback cobre a noite inteira", async () => {
    // 10h UTC = 07h em São Paulo, primeira hora da janela.
    vi.setSystemTime(new Date("2026-07-24T10:00:00Z"));
    notifMany.mockResolvedValue([]);

    await sweepUserNotifications();

    const gte = notifMany.mock.calls[0][0].where.createdAt.gte as Date;
    const horasDeLookback = (Date.now() - gte.getTime()) / 3_600_000;
    // Precisa alcançar as 22h do dia anterior (9h atrás), com folga.
    expect(horasDeLookback).toBeGreaterThanOrEqual(9);
  });

  it("fora da primeira hora usa a janela curta (não redispara backlog)", async () => {
    // 18h UTC = 15h em São Paulo.
    vi.setSystemTime(new Date("2026-07-24T18:00:00Z"));
    notifMany.mockResolvedValue([]);

    await sweepUserNotifications();

    const gte = notifMany.mock.calls[0][0].where.createdAt.gte as Date;
    expect((Date.now() - gte.getTime()) / 60_000).toBeCloseTo(30, 0);
  });

  it("retoma entregas adiadas antes de olhar novidades", async () => {
    delivMany.mockResolvedValue([{ notificationId: "notif-antiga" }]);
    notifMany.mockResolvedValue([]);
    notifFind.mockResolvedValue(notifRow({ id: "notif-antiga" }));

    const r = await sweepUserNotifications();

    expect(r.resumed).toBe(1);
    expect(r.sent).toBe(1);
    const where = delivMany.mock.calls[0][0].where;
    expect(where.OR).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: { in: ["deferred", "failed"] } }),
      ])
    );
  });

  it("não duplica quando a mesma notificação está na retomada e nas novidades", async () => {
    delivMany.mockResolvedValue([{ notificationId: "notif1" }]);
    notifMany.mockResolvedValue([notifRow()]);
    notifFind.mockResolvedValue(notifRow());

    const r = await sweepUserNotifications();

    expect(r.scanned).toBe(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
