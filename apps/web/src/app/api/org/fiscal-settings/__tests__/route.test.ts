/**
 * `/api/org/fiscal-settings` — contrato dos 8 campos de recebimento da
 * imobiliária (Perfil): enum fora do domínio é 400, sem permissão é 403, o
 * PATCH grava só o que veio e o GET devolve os campos. Prisma vem do mock
 * global do setup; auth/permissão/impersonação/audit mockados aqui.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET, PATCH } from "../route";
import { requireAuth } from "@/lib/auth/context";
import { requirePermission, PermissionDeniedError } from "@/lib/security/rbac/guard";
import { prisma } from "@/lib/db/prisma";

vi.mock("@/lib/auth/context", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/auth/impersonation", () => ({
  getEffectiveUserId: vi.fn(async (id: string) => id),
}));
vi.mock("@/lib/security/rbac/guard", async (orig) => ({
  ...(await orig<typeof import("@/lib/security/rbac/guard")>()),
  requirePermission: vi.fn(),
}));
vi.mock("@/lib/security/audit", () => ({
  audit: vi.fn().mockResolvedValue(undefined),
  extractAuditContextFromRequest: vi.fn(() => ({})),
}));

const auth = vi.mocked(requireAuth);
const perm = vi.mocked(requirePermission);
const update = vi.mocked(prisma.organization.update);
const findUnique = vi.mocked(prisma.organization.findUnique);

const RECEBIMENTO = {
  pixAddressKey: "12.345.678/0001-90",
  pixKeyType: "CNPJ",
  bankName: "",
  bankBranch: "",
  bankAccount: "",
  bankAccountType: "",
  bankHolderName: "Imobiliária Exemplo Ltda",
  bankHolderDoc: "",
};

function req(method: string, body?: unknown) {
  return new NextRequest("http://localhost/api/org/fiscal-settings", {
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.mockResolvedValue({ ok: true, ctx: { orgId: "org-1", userId: "u-1" } } as never);
  perm.mockResolvedValue(undefined as never);
  update.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ legalName: null, ...args.data }) as never);
  findUnique.mockResolvedValue({ legalName: "Imobiliária Exemplo Ltda", ...RECEBIMENTO } as never);
});

describe("PATCH /api/org/fiscal-settings — recebimento da imobiliária", () => {
  it("grava só os campos enviados e devolve os 8 de recebimento", async () => {
    const res = await PATCH(req("PATCH", RECEBIMENTO));
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "org-1" },
        data: RECEBIMENTO,
        select: expect.objectContaining({ pixAddressKey: true, bankHolderDoc: true }),
      })
    );
    const json = await res.json();
    expect(json.pixAddressKey).toBe("12.345.678/0001-90");
  });

  it("enum fora do domínio → 400 (tipo de chave PIX e tipo de conta)", async () => {
    expect((await PATCH(req("PATCH", { pixKeyType: "RG" }))).status).toBe(400);
    expect((await PATCH(req("PATCH", { bankAccountType: "salario" }))).status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it('"" é aceito como "não informado" nos enums', async () => {
    const res = await PATCH(req("PATCH", { pixKeyType: "", bankAccountType: "" }));
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { pixKeyType: "", bankAccountType: "" } })
    );
  });

  it("sem ORG_SETTINGS_EDIT → 403 e nada é gravado", async () => {
    perm.mockRejectedValueOnce(new PermissionDeniedError("org.settings.edit") as never);
    const res = await PATCH(req("PATCH", RECEBIMENTO));
    expect(res.status).toBe(403);
    expect(update).not.toHaveBeenCalled();
  });
});

describe("GET /api/org/fiscal-settings", () => {
  it("devolve os campos de recebimento junto dos cadastrais (objeto plano — é o que o hook hidrata)", async () => {
    const res = await GET(req("GET"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ legalName: "Imobiliária Exemplo Ltda", pixAddressKey: "12.345.678/0001-90" });
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ select: expect.objectContaining({ pixAddressKey: true, bankAccountType: true }) })
    );
  });
});
