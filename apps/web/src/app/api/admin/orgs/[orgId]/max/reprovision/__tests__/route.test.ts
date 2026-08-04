/**
 * Reemissão forçada do acesso do Max.
 *
 * O que este arquivo protege é a razão de a rota existir: a trava de `noop` do
 * endpoint do dono fechou o único caminho de reemitir de propósito, e reemitir
 * é o certo em dois casos — token vazado e escopo novo. Aqui NÃO pode haver
 * `noop`: uma rota de rotação que se recusa a rotacionar é uma rota inútil.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../route";
import { auth } from "@/lib/auth/auth";
import { requirePlatformRole } from "@/lib/security/rbac/platform";
import { syncMaxForOrg } from "@/lib/max/provisioning";

vi.mock("@/lib/security/rbac/platform", async (orig) => ({
  ...(await orig<typeof import("@/lib/security/rbac/platform")>()),
  requirePlatformRole: vi.fn(),
}));
vi.mock("@/lib/max/provisioning", async (orig) => ({
  ...(await orig<typeof import("@/lib/max/provisioning")>()),
  syncMaxForOrg: vi.fn(),
}));

const mockAuth = vi.mocked(auth);
const role = vi.mocked(requirePlatformRole);
const sync = vi.mocked(syncMaxForOrg);

const req = () =>
  new NextRequest("http://localhost/api/admin/orgs/org-1/max/reprovision", {
    method: "POST",
  });
const params = { params: { orgId: "org-1" } };

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "u-1" } } as never);
  role.mockResolvedValue(undefined as never);
  sync.mockResolvedValue({ action: "provisioned", delivered: true } as never);
});

describe("POST /api/admin/orgs/[orgId]/max/reprovision", () => {
  it("401 sem sessão", async () => {
    mockAuth.mockResolvedValue(null as never);
    expect((await POST(req(), params)).status).toBe(401);
  });

  it("exige super_admin", async () => {
    const { PlatformRoleRequiredError } = await import(
      "@/lib/security/rbac/platform"
    );
    role.mockRejectedValue(new PlatformRoleRequiredError("super_admin") as never);

    const res = await POST(req(), params);

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(sync).not.toHaveBeenCalled();
  });

  /**
   * O ponto da rota. O endpoint do dono responde `noop` quando a org está
   * saudável; aqui a org saudável é justamente o caso de uso (token vazou,
   * escopo mudou) e a reemissão TEM que acontecer.
   */
  it("org saudável é reemitida mesmo assim — sem noop", async () => {
    const res = await POST(req(), params);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, delivered: true });
    expect(body.noop).toBeUndefined();
    expect(sync).toHaveBeenCalledWith("org-1");
  });

  /**
   * Mesmo motivo do endpoint do dono: um erro faria o operador rodar de novo, e
   * cada execução rotaciona OUTRA vez — o serviço ficaria um token mais
   * atrasado a cada tentativa.
   */
  it("falha de entrega é 200 com delivered:false, não erro", async () => {
    sync.mockResolvedValue({
      action: "provisioned",
      delivered: false,
      detail: "unreachable",
    } as never);

    const res = await POST(req(), params);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ delivered: false });
  });
});
