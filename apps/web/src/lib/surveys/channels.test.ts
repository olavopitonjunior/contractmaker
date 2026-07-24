import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/email/client", () => ({
  sendEmail: vi.fn().mockResolvedValue({ ok: true, id: "email-1" }),
}));
vi.mock("@/lib/newton/gate", () => ({
  isNewtonEnabledForDeal: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/newton/trigger", () => ({
  triggerNewtonForRequest: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from "@/lib/db/prisma";
import { sendEmail } from "@/lib/email/client";
import { isNewtonEnabledForDeal } from "@/lib/newton/gate";
import { triggerNewtonForRequest } from "@/lib/newton/trigger";
import {
  sendSurveyInvite,
  whatsappTargetPhone,
} from "./channels";

const DEAL = { id: "deal-1", kind: "venda", userId: "user-1" };

function makeInvite(overrides: Partial<Parameters<typeof sendSurveyInvite>[0]["invite"]> = {}) {
  return {
    id: "inv-1",
    token: "tok-abc",
    channel: "whatsapp",
    recipientName: "Maria Compradora",
    recipientEmail: "maria@example.com",
    recipientPhone: "11987654321",
    remindersSent: 0,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isNewtonEnabledForDeal).mockResolvedValue(true);
  vi.mocked(sendEmail).mockResolvedValue({ ok: true, id: "email-1" } as never);
  vi.mocked(prisma.newtonRequest.findFirst).mockResolvedValue(null as never);
  vi.mocked(prisma.newtonRequest.create).mockResolvedValue({ id: "nr-1" } as never);
});

describe("whatsappTargetPhone", () => {
  it("converte celular BR pra E.164 sem + com DDI 55", () => {
    expect(whatsappTargetPhone("11987654321")).toBe("5511987654321");
    expect(whatsappTargetPhone("(11) 98765-4321")).toBe("5511987654321");
  });

  it("não duplica DDI 55 já presente", () => {
    expect(whatsappTargetPhone("5511987654321")).toBe("5511987654321");
  });

  it("rejeita telefone curto/inválido", () => {
    expect(whatsappTargetPhone("987654321")).toBeNull();
    expect(whatsappTargetPhone("")).toBeNull();
    expect(whatsappTargetPhone(null)).toBeNull();
  });
});

describe("sendSurveyInvite — canal whatsapp", () => {
  it("cria NewtonRequest one-shot com tag e link, e dispara o trigger", async () => {
    const result = await sendSurveyInvite({
      invite: makeInvite(),
      templateName: "Satisfação pós-venda",
      orgId: "org-1",
      deal: DEAL,
    });

    expect(result).toMatchObject({ ok: true, channel: "whatsapp", newtonRequestId: "nr-1" });
    const createArg = vi.mocked(prisma.newtonRequest.create).mock.calls[0][0] as {
      data: { ask: string; targetRef: string; dealId: string; createdBy: string };
    };
    expect(createArg.data.ask).toContain("[survey_invite][inv-1]");
    expect(createArg.data.ask).toContain("/s/tok-abc");
    expect(createArg.data.ask).toContain("fulfilled");
    expect(createArg.data.targetRef).toBe("5511987654321");
    expect(createArg.data.dealId).toBe("deal-1");
    expect(createArg.data.createdBy).toBe("user-1");
    expect(triggerNewtonForRequest).toHaveBeenCalledOnce();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("telefone inválido → fallback email", async () => {
    const result = await sendSurveyInvite({
      invite: makeInvite({ recipientPhone: "123" }),
      templateName: "Pesquisa",
      orgId: "org-1",
      deal: DEAL,
    });
    expect(result).toMatchObject({ ok: true, channel: "email", fellBack: true });
    expect(prisma.newtonRequest.create).not.toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalledOnce();
  });

  it("Newton desabilitado → fallback email", async () => {
    vi.mocked(isNewtonEnabledForDeal).mockResolvedValue(false);
    const result = await sendSurveyInvite({
      invite: makeInvite(),
      templateName: "Pesquisa",
      orgId: "org-1",
      deal: DEAL,
    });
    expect(result).toMatchObject({ ok: true, channel: "email", fellBack: true });
  });

  it("sem deal → fallback email", async () => {
    const result = await sendSurveyInvite({
      invite: makeInvite(),
      templateName: "Pesquisa",
      orgId: "org-1",
      deal: null,
    });
    expect(result).toMatchObject({ ok: true, channel: "email", fellBack: true });
  });

  it("inviável e sem email → failed", async () => {
    const result = await sendSurveyInvite({
      invite: makeInvite({ recipientPhone: "123", recipientEmail: null }),
      templateName: "Pesquisa",
      orgId: "org-1",
      deal: DEAL,
    });
    expect(result.ok).toBe(false);
    expect(prisma.surveyInvite.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "failed" } })
    );
  });

  it("reminder cria pedido novo com tag numerada e não rebaixa status em falha", async () => {
    await sendSurveyInvite({
      invite: makeInvite({ remindersSent: 1 }),
      templateName: "Pesquisa",
      orgId: "org-1",
      deal: DEAL,
      isReminder: true,
    });
    const createArg = vi.mocked(prisma.newtonRequest.create).mock.calls[0][0] as {
      data: { ask: string };
    };
    expect(createArg.data.ask).toContain("[survey_reminder][inv-1][2]");

    // Reminder inviável sem email: não marca failed.
    vi.clearAllMocks();
    vi.mocked(isNewtonEnabledForDeal).mockResolvedValue(false);
    const result = await sendSurveyInvite({
      invite: makeInvite({ recipientEmail: null, remindersSent: 1 }),
      templateName: "Pesquisa",
      orgId: "org-1",
      deal: DEAL,
      isReminder: true,
    });
    expect(result.ok).toBe(false);
    expect(prisma.surveyInvite.update).not.toHaveBeenCalled();
  });

  it("dedupe por tag: pedido existente não cria duplicata", async () => {
    vi.mocked(prisma.newtonRequest.findFirst).mockResolvedValue({ id: "nr-existente" } as never);
    const result = await sendSurveyInvite({
      invite: makeInvite(),
      templateName: "Pesquisa",
      orgId: "org-1",
      deal: DEAL,
    });
    expect(result).toMatchObject({ ok: true, channel: "whatsapp", newtonRequestId: "nr-existente" });
    expect(prisma.newtonRequest.create).not.toHaveBeenCalled();
  });
});
