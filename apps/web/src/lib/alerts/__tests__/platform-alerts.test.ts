/**
 * O que este arquivo protege: o ANTI-SPAM do motor de alerta.
 *
 * O risco da fase inteira é o alerta virar ruído e treinar o dono a
 * ignorá-lo — então o que se trava aqui não é "e-mail sai", é "e-mail NÃO
 * sai quando não deve": repetição dentro do re-arm, tempestade acima do
 * teto horário, digest que nunca e-maila na hora, e envio falho que não
 * carimba notifiedAt (senão o alerta se perde pra sempre).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { __doReportForTests as report, reportPlatformAlert } from "../platform-alerts";
import { prisma } from "@/lib/db/prisma";
import { sendEmail } from "@/lib/email/client";

vi.mock("@/lib/email/client", () => ({
  sendEmail: vi.fn().mockResolvedValue({ ok: true }),
}));

const mockPrisma = vi.mocked(prisma);
const mockSendEmail = vi.mocked(sendEmail);

function linha(over: Record<string, unknown> = {}) {
  return {
    id: "alert-1",
    kind: "integration_failure",
    signature: "CLICKSIGN_SEND:org-1",
    orgId: "org-1",
    severity: "warning",
    title: "t",
    count: 1,
    firstSeenAt: new Date("2026-08-01T00:00:00Z"),
    lastSeenAt: new Date(),
    notifiedAt: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSendEmail.mockResolvedValue({ ok: true } as never);
  mockPrisma.platformAlertEvent.upsert.mockResolvedValue(linha() as never);
  mockPrisma.platformAlertEvent.count.mockResolvedValue(0 as never);
  mockPrisma.platformRole.findMany.mockResolvedValue([
    { user: { email: "dono@x.com" } },
  ] as never);
  mockPrisma.organization.findUnique.mockResolvedValue({
    name: "Newcore",
  } as never);
});

const base = {
  kind: "integration_failure" as const,
  signature: "CLICKSIGN_SEND:org-1",
  orgId: "org-1",
  title: "Integração falhando: CLICKSIGN_SEND",
  notify: "immediate" as const,
};

describe("motor de alerta — anti-spam", () => {
  it("1ª ocorrência imediata: e-maila e carimba notifiedAt", async () => {
    await report(base);
    expect(mockSendEmail).toHaveBeenCalledOnce();
    expect(mockSendEmail.mock.calls[0][0].to).toEqual(["dono@x.com"]);
    expect(mockPrisma.platformAlertEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { notifiedAt: expect.any(Date) },
      })
    );
  });

  it("repetição dentro do re-arm de 24h: SEM e-mail (vira digest)", async () => {
    mockPrisma.platformAlertEvent.upsert.mockResolvedValue(
      linha({ notifiedAt: new Date(Date.now() - 60 * 60 * 1000), count: 5 }) as never
    );
    await report(base);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("re-armado após 24h: e-maila de novo", async () => {
    mockPrisma.platformAlertEvent.upsert.mockResolvedValue(
      linha({ notifiedAt: new Date(Date.now() - 25 * 60 * 60 * 1000), count: 9 }) as never
    );
    await report(base);
    expect(mockSendEmail).toHaveBeenCalledOnce();
  });

  it("tempestade: teto horário segura o e-mail (o digest cobre)", async () => {
    mockPrisma.platformAlertEvent.count.mockResolvedValue(10 as never);
    await report(base);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("digest nunca e-maila na hora — só acumula", async () => {
    await report({ ...base, notify: "digest" });
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockPrisma.platformAlertEvent.upsert).toHaveBeenCalledOnce();
  });

  it("envio falho NÃO carimba notifiedAt — o digest recupera", async () => {
    mockSendEmail.mockResolvedValue({ ok: false, error: "smtp fora" } as never);
    await report(base);
    expect(mockPrisma.platformAlertEvent.update).not.toHaveBeenCalled();
  });

  it("sem super_admin com e-mail: acumula sem quebrar", async () => {
    mockPrisma.platformRole.findMany.mockResolvedValue([] as never);
    await report(base);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("o público (fire-and-forget) NUNCA lança, mesmo com o banco fora", async () => {
    mockPrisma.platformAlertEvent.upsert.mockRejectedValue(
      new Error("db fora") as never
    );
    expect(() => reportPlatformAlert(base)).not.toThrow();
    // dá um tick pro catch interno rodar
    await new Promise((r) => setTimeout(r, 0));
  });
});
