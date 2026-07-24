import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { dispatchUserNotification, sweepUserNotifications } from "../user-channels";

vi.mock("@/lib/newton/notify-trigger", () => ({
  triggerNewtonNotify: vi.fn().mockResolvedValue("sent"),
}));

import { triggerNewtonNotify } from "@/lib/newton/notify-trigger";

const trigger = triggerNewtonNotify as unknown as ReturnType<typeof vi.fn>;
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
    trigger.mockResolvedValue("sent");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("envia quando há opt-in com consentimento datado", async () => {
    const r = await dispatchUserNotification({ notificationId: "notif1" });

    expect(r.sent).toBe(1);
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveBeenCalledWith(
      expect.objectContaining({
        audience: "platform_user",
        orgId: "org1",
        phone: "+5511987654321",
        orgName: "Imobiliária Teste",
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
    expect(trigger).not.toHaveBeenCalled();
    expect(delivCreate).not.toHaveBeenCalled();
  });

  it("não envia com toggle ligado mas sem whatsappOptInAt", async () => {
    prefMany.mockResolvedValue([pref("user1", "deal_updates", { whatsappOptInAt: null })]);

    const r = await dispatchUserNotification({ notificationId: "notif1" });

    expect(r.sent).toBe(0);
    expect(trigger).not.toHaveBeenCalled();
  });

  it("respeita o kill switch global da org mesmo com opt-in", async () => {
    orgSettings.mockResolvedValue({ settingsJson: { userChannels: { enabled: false } } });

    const r = await dispatchUserNotification({ notificationId: "notif1" });

    expect(r.sent).toBe(0);
    expect(trigger).not.toHaveBeenCalled();
  });

  it("respeita o kill switch por categoria", async () => {
    orgSettings.mockResolvedValue({
      settingsJson: { userChannels: { events: { deal_updates: false } } },
    });

    const r = await dispatchUserNotification({ notificationId: "notif1" });

    expect(r.sent).toBe(0);
    expect(trigger).not.toHaveBeenCalled();
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
    expect(trigger).not.toHaveBeenCalled();
  });

  it("tipo fora da allowlist é no-op total", async () => {
    notifFind.mockResolvedValue(notifRow({ type: "survey_response" }));

    const r = await dispatchUserNotification({ notificationId: "notif1" });

    expect(r).toEqual({ sent: 0, skipped: 0, deferred: 0 });
    expect(delivCreate).not.toHaveBeenCalled();
    expect(trigger).not.toHaveBeenCalled();
  });

  it("fora da janela 7h-22h fica deferred, sem claim", async () => {
    // 06h UTC = 03h em São Paulo.
    vi.setSystemTime(new Date("2026-07-24T06:00:00Z"));

    const r = await dispatchUserNotification({ notificationId: "notif1" });

    expect(r.deferred).toBe(1);
    expect(r.sent).toBe(0);
    expect(delivCreate).not.toHaveBeenCalled();
    expect(trigger).not.toHaveBeenCalled();
  });

  it("rate cap por usuário/hora pula o envio e registra o motivo", async () => {
    delivCount.mockResolvedValue(6);

    const r = await dispatchUserNotification({ notificationId: "notif1" });

    expect(r.skipped).toBe(1);
    expect(trigger).not.toHaveBeenCalled();
    expect(delivUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "skipped",
          detail: { reason: "rate_cap" },
        }),
      })
    );
  });

  it("gate do Newton fechado assenta skipped, não sent", async () => {
    trigger.mockResolvedValue("skipped");

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

  it("usuário sem telefone não recebe", async () => {
    membershipMany.mockResolvedValue([
      member("user1", { user: { name: "X", phone: null, deletedAt: null } }),
    ]);

    const r = await dispatchUserNotification({ notificationId: "notif1" });

    expect(r.sent).toBe(0);
    expect(trigger).not.toHaveBeenCalled();
  });

  it("notificação inexistente é no-op", async () => {
    notifFind.mockResolvedValue(null);

    const r = await dispatchUserNotification({ notificationId: "sumiu" });

    expect(r).toEqual({ sent: 0, skipped: 0, deferred: 0 });
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
    trigger.mockResolvedValue("sent");
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

  it("fora da janela nem consulta o banco", async () => {
    vi.setSystemTime(new Date("2026-07-24T06:00:00Z"));

    const r = await sweepUserNotifications();

    expect(r.scanned).toBe(0);
    expect(notifMany).not.toHaveBeenCalled();
  });

  it("erro de query não propaga", async () => {
    notifMany.mockRejectedValue(new Error("db caiu"));

    await expect(sweepUserNotifications()).resolves.toEqual({
      scanned: 0,
      sent: 0,
      skipped: 0,
      deferred: 0,
    });
  });
});
