import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";

vi.mock("@/lib/security/crypto", () => ({
  decryptSecret: vi.fn(({ ciphertext }: { ciphertext: string }) => `dec:${ciphertext}`),
  encryptSecret: vi.fn((v: string) => ({ ciphertext: `enc:${v}`, iv: "iv", tag: "tag" })),
  generatePublicToken: vi.fn(() => "slug16"),
  generateSecureToken: vi.fn(() => "secret24"),
}));

import {
  FichaCertaNotConfiguredError,
  getOrgFichaCertaCreds,
  isFichaCertaConfigured,
  parseProducts,
  requireFichaCertaCreds,
  tokenUrlForSlug,
  webhookUrlForSlug,
} from "../account";

const accFind = prisma.fichaCertaAccount.findUnique as unknown as ReturnType<typeof vi.fn>;

function account(over: Record<string, unknown> = {}) {
  return {
    id: "fca1",
    orgId: "org-x",
    login: "api@imob.com.br",
    passwordEncrypted: "pw",
    passwordIvBase64: "iv",
    passwordTagBase64: "tag",
    baseUrl: "https://api.fichacertadigital.com.br/",
    webhookSlug: "slug16",
    webhookTokenUser: "fc_slug16",
    webhookTokenPasswordEncrypted: "tp",
    webhookTokenPasswordIvBase64: "iv",
    webhookTokenPasswordTagBase64: "tag",
    webhookQuerySecretEncrypted: "qs",
    webhookQuerySecretIvBase64: "iv",
    webhookQuerySecretTagBase64: "tag",
    products: "1,9",
    costCents: 1500,
    status: "connected",
    ...over,
  };
}

describe("FichaCertaAccount — credencial por org, sem fallback global", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    accFind.mockResolvedValue(null);
  });

  it("conta conectada → creds da org com senha decifrada e baseUrl normalizada", async () => {
    accFind.mockResolvedValue(account());
    const creds = await getOrgFichaCertaCreds("org-x");
    expect(creds).toEqual({
      orgId: "org-x",
      login: "api@imob.com.br",
      password: "dec:pw",
      baseUrl: "https://api.fichacertadigital.com.br",
      products: [1, 9],
      costCents: 1500,
    });
    expect(await isFichaCertaConfigured("org-x")).toBe(true);
  });

  it("sem conta → null; NUNCA cai em token de env", async () => {
    process.env.FICHACERTA_LOGIN = "x";
    process.env.FICHACERTA_PASSWORD = "y";
    expect(await getOrgFichaCertaCreds("org-x")).toBeNull();
    expect(await isFichaCertaConfigured("org-x")).toBe(false);
    await expect(requireFichaCertaCreds("org-x")).rejects.toBeInstanceOf(FichaCertaNotConfiguredError);
    delete process.env.FICHACERTA_LOGIN;
    delete process.env.FICHACERTA_PASSWORD;
  });

  it("conta desconectada → null", async () => {
    accFind.mockResolvedValue(account({ status: "disconnected" }));
    expect(await getOrgFichaCertaCreds("org-x")).toBeNull();
  });

  it("parseProducts tolera lixo e dedupe; vazio → [1]", () => {
    expect(parseProducts("1,9")).toEqual([1, 9]);
    expect(parseProducts(" 9 , 9, x, 0")).toEqual([9]);
    expect(parseProducts("")).toEqual([1]);
    expect(parseProducts(null)).toEqual([1]);
  });

  it("URLs públicas do webhook derivam do slug", () => {
    expect(webhookUrlForSlug("abc")).toMatch(/\/api\/webhooks\/fichacerta\/abc$/);
    expect(tokenUrlForSlug("abc")).toMatch(/\/api\/webhooks\/fichacerta\/abc\/token$/);
  });
});
