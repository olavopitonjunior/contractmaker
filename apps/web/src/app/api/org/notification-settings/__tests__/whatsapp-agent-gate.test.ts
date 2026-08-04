/**
 * Disponibilidade de agente de WhatsApp na tela de notificações da org.
 *
 * O bug que este arquivo tranca: a rota perguntava `isNewtonEnabledForOrg`
 * diretamente, então **toda org só-Max era tratada como se não tivesse agente**
 * — a tela mostrava o aviso "sem agente de WhatsApp", desabilitava os
 * checkboxes e o PATCH recusava com 422. Isso apesar de `user-channels.ts` e
 * `whatsapp-router.ts` já saberem entregar pelo Max.
 *
 * A propriedade que interessa não é "o Newton está ligado": é **"existe ALGUM
 * agente"**. Por isso as asserções são sobre o roteador, e não sobre um gate
 * específico — quem adicionar um terceiro agente não deve precisar mexer aqui.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../route";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { resolveWhatsappAgent } from "@/lib/agents/whatsapp-router";

vi.mock("@/lib/auth/context", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/agents/whatsapp-router", () => ({
  resolveWhatsappAgent: vi.fn(),
}));
vi.mock("@/lib/notifications/deal-events-config", async (orig) => ({
  ...(await orig<typeof import("@/lib/notifications/deal-events-config")>()),
  resolveEffectiveNotificationConfig: vi.fn().mockResolvedValue({}),
}));

const mockPrisma = vi.mocked(prisma);
const auth = vi.mocked(requireAuth);
const resolveAgent = vi.mocked(resolveWhatsappAgent);

const req = () =>
  new NextRequest("http://localhost/api/org/notification-settings");

beforeEach(() => {
  vi.clearAllMocks();
  auth.mockResolvedValue({
    ok: true,
    ctx: { orgId: "org-1", userId: "u-1" },
  } as never);
  mockPrisma.orgNotificationSettings.findUnique.mockResolvedValue({
    orgId: "org-1",
    settingsJson: {},
  } as never);
  mockPrisma.orgNotificationSettings.create.mockResolvedValue({
    orgId: "org-1",
    settingsJson: {},
  } as never);
  mockPrisma.orgMembership.findMany.mockResolvedValue([] as never);
  mockPrisma.userNotificationPreference.findMany.mockResolvedValue([] as never);
});

describe("whatsappAgentAvailable", () => {
  it("org só-Max é tratada como TENDO agente", async () => {
    resolveAgent.mockResolvedValue("max");

    const body = await (await GET(req())).json();

    expect(body.whatsappAgentAvailable).toBe(true);
  });

  it("org só-Newton continua tendo agente (não regrediu)", async () => {
    resolveAgent.mockResolvedValue("newton");

    const body = await (await GET(req())).json();

    expect(body.whatsappAgentAvailable).toBe(true);
  });

  it("org sem agente nenhum segue sem", async () => {
    resolveAgent.mockResolvedValue(null);

    const body = await (await GET(req())).json();

    expect(body.whatsappAgentAvailable).toBe(false);
  });

  /**
   * `dealKind` ausente é intencional: aqui a pergunta é "esta org tem algum
   * agente, em qualquer módulo?". Passar um kind restringiria a vendas ou
   * locação e voltaria a esconder o canal de metade dos tenants.
   */
  it("pergunta pela org inteira, sem restringir a um módulo", async () => {
    resolveAgent.mockResolvedValue("max");

    await GET(req());

    expect(resolveAgent).toHaveBeenCalledWith("org-1");
  });
});
