/**
 * O que este arquivo protege: a semântica de "pendente" do digest e o
 * carimbo pós-envio. Sem o carimbo, o mesmo item re-aparece amanhã como se
 * fosse novo; com o carimbo em envio FALHO, o alerta se perde pra sempre.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../route";
import { prisma } from "@/lib/db/prisma";
import { sendEmail } from "@/lib/email/client";

vi.mock("@/lib/email/client", () => ({
  sendEmail: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock("@/lib/security/cron-auth", () => ({
  requireCronAuth: vi.fn().mockReturnValue(null),
}));
vi.mock("@/lib/env/staging", () => ({
  isCronAllowedInStaging: vi.fn().mockResolvedValue(true),
}));

const mockPrisma = vi.mocked(prisma);
const mockSendEmail = vi.mocked(sendEmail);

function req() {
  return new NextRequest("http://localhost/api/cron/alerts/digest");
}

function alerta(over: Record<string, unknown> = {}) {
  return {
    id: "a1",
    kind: "ai_budget",
    signature: "fallback:sonnet",
    orgId: null,
    severity: "info",
    title: "Fallback por sobrecarga",
    count: 7,
    firstSeenAt: new Date(),
    lastSeenAt: new Date(),
    notifiedAt: null,
    payload: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSendEmail.mockResolvedValue({ ok: true } as never);
  mockPrisma.platformAlertEvent.findMany.mockResolvedValue([] as never);
  mockPrisma.platformAlertEvent.updateMany.mockResolvedValue({ count: 0 } as never);
  mockPrisma.platformRole.findMany.mockResolvedValue([
    { user: { email: "dono@x.com" } },
  ] as never);
  mockPrisma.organization.findMany.mockResolvedValue([] as never);
});

describe("GET /api/cron/alerts/digest", () => {
  it("sem pendentes: não envia nada", async () => {
    const body = await (await GET(req())).json();
    expect(body.sent).toBe(false);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("já-notificado sem ocorrência nova fica FORA; com ocorrência nova entra", async () => {
    const agora = new Date();
    const ontem = new Date(agora.getTime() - 60 * 60 * 1000);
    mockPrisma.platformAlertEvent.findMany.mockResolvedValue([
      // imediato já e-mailado e sem repetição: notifiedAt >= lastSeenAt → fora
      alerta({ id: "quieto", notifiedAt: agora, lastSeenAt: ontem }),
      // repetiu depois do e-mail: lastSeenAt > notifiedAt → entra
      alerta({ id: "repetiu", notifiedAt: ontem, lastSeenAt: agora }),
      // nunca notificado → entra
      alerta({ id: "novo" }),
    ] as never);

    const body = await (await GET(req())).json();
    expect(body.sent).toBe(true);
    expect(body.items).toBe(2);
    expect(mockPrisma.platformAlertEvent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["repetiu", "novo"] } },
      })
    );
  });

  it("envio falho NÃO carimba — os itens seguem pendentes pro dia seguinte", async () => {
    mockSendEmail.mockResolvedValue({ ok: false, error: "smtp fora" } as never);
    mockPrisma.platformAlertEvent.findMany.mockResolvedValue([alerta()] as never);
    const body = await (await GET(req())).json();
    expect(body.sent).toBe(false);
    expect(mockPrisma.platformAlertEvent.updateMany).not.toHaveBeenCalled();
  });
});
