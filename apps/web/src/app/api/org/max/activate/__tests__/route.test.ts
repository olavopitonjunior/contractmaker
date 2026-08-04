/**
 * Ativação do Max pelo dono da imobiliária.
 *
 * O que este arquivo protege são as duas chaves: o super_admin torna o canal
 * DISPONÍVEL (o Max compartilha um número e uma instância Z-API entre tenants,
 * então capacidade e custo ficam com quem paga a conta) e o dono ATIVA. Sem a
 * primeira, este endpoint não pode provisionar — seria emitir credencial para
 * um canal que o tenant não contratou.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../route";
import { requireAuth } from "@/lib/auth/context";
import { requirePermission } from "@/lib/security/rbac/guard";
import { prisma } from "@/lib/db/prisma";
import { syncMaxForOrg } from "@/lib/max/provisioning";

vi.mock("@/lib/auth/context", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/auth/impersonation", () => ({
  getEffectiveUserId: vi.fn(async (id: string) => id),
  getImpersonationFor: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/security/rbac/guard", async (orig) => ({
  ...(await orig<typeof import("@/lib/security/rbac/guard")>()),
  requirePermission: vi.fn(),
}));
vi.mock("@/lib/max/provisioning", async (orig) => ({
  ...(await orig<typeof import("@/lib/max/provisioning")>()),
  syncMaxForOrg: vi.fn(),
}));

const auth = vi.mocked(requireAuth);
const perm = vi.mocked(requirePermission);
const sync = vi.mocked(syncMaxForOrg);
const mockPrisma = vi.mocked(prisma);

const req = () =>
  new NextRequest("http://localhost/api/org/max/activate", { method: "POST" });

/** Liga (ou não) a feature do Max para a org. */
function disponivel(on: boolean) {
  mockPrisma.orgModule.findMany.mockResolvedValue([
    {
      module: "vendas",
      enabled: true,
      featureFlags: on ? { "vendas.max": true } : {},
    },
  ] as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.mockResolvedValue({
    ok: true,
    ctx: { orgId: "org-1", userId: "u-1" },
  } as never);
  perm.mockResolvedValue(undefined as never);
  sync.mockResolvedValue({
    action: "provisioned",
    delivered: true,
  } as never);
  disponivel(true);
});

describe("as duas chaves", () => {
  it("canal disponível + dono com permissão → provisiona", async () => {
    const res = await POST(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.delivered).toBe(true);
    expect(sync).toHaveBeenCalledWith("org-1");
  });

  /**
   * A trava que impede o dono de se auto-servir de um canal pago que o
   * super_admin não liberou.
   */
  it("canal indisponível → 409 e NÃO provisiona", async () => {
    disponivel(false);

    const res = await POST(req());

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "MAX_NOT_AVAILABLE" });
    expect(sync).not.toHaveBeenCalled();
  });

  it("sem ORG_SETTINGS_EDIT não provisiona", async () => {
    const { PermissionDeniedError } = await import("@/lib/security/rbac/guard");
    perm.mockRejectedValue(new PermissionDeniedError("perm" as never) as never);

    const res = await POST(req());

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(sync).not.toHaveBeenCalled();
  });
});

describe("entrega ao serviço", () => {
  /**
   * O token foi emitido e é válido; o que faltou foi a entrega, que o cron
   * reconcilia. Um 500 aqui faria o dono clicar de novo achando que nada
   * aconteceu — e cada clique ROTACIONA o token, porque `createApiToken` não é
   * idempotente.
   */
  it("falha de entrega responde 200 com delivered:false, não erro", async () => {
    sync.mockResolvedValue({
      action: "provisioned",
      delivered: false,
      detail: "unreachable: timeout",
    } as never);

    const res = await POST(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.delivered).toBe(false);
    expect(body.detail).toContain("timeout");
  });

  it("chamar duas vezes é seguro — o sync é idempotente", async () => {
    await POST(req());
    await POST(req());

    expect(sync).toHaveBeenCalledTimes(2);
    expect(sync).toHaveBeenNthCalledWith(2, "org-1");
  });
});
