import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";

vi.mock("@/lib/security/crypto", () => ({
  decryptSecret: vi.fn(({ ciphertext }: { ciphertext: string }) => `dec:${ciphertext}`),
  encryptSecret: vi.fn((v: string) => ({ ciphertext: `enc:${v}`, iv: "iv", tag: "tag" })),
  generatePublicToken: vi.fn(() => "slugNEW"),
  generateSecureToken: vi.fn(() => "secretNEW"),
}));
vi.mock("../client", () => ({
  getCredits: vi.fn(),
  registerWebhook: vi.fn(),
  deleteWebhook: vi.fn(),
}));

import { getCredits, registerWebhook, deleteWebhook } from "../client";
import { FichaCertaError } from "../types";
import { connectFichaCertaAccount, disconnectFichaCertaAccount, FichaCertaConnectError } from "../connect";

const accFind = prisma.fichaCertaAccount.findUnique as unknown as ReturnType<typeof vi.fn>;
const accUpsert = prisma.fichaCertaAccount.upsert as unknown as ReturnType<typeof vi.fn>;
const accDelete = prisma.fichaCertaAccount.delete as unknown as ReturnType<typeof vi.fn>;
const creditsMock = getCredits as unknown as ReturnType<typeof vi.fn>;
const webhookMock = registerWebhook as unknown as ReturnType<typeof vi.fn>;

const base = { orgId: "org1", userId: "u1", login: "api@imob.com.br", password: "pw" };

describe("connectFichaCertaAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    accFind.mockResolvedValue(null);
    accUpsert.mockResolvedValue({});
    creditsMock.mockResolvedValue(120);
    webhookMock.mockResolvedValue({ id: 7, message: "Webhook cadastrado" });
  });

  it("credencial válida: cifra senha e segredos, provisiona o webhook com token_url e ?k=", async () => {
    const r = await connectFichaCertaAccount({ ...base, products: "1,9" });
    expect(r).toMatchObject({ ok: true, credits: 120, webhookProvisioned: true, products: [1, 9] });
    expect(r.webhookUrl).toMatch(/\/api\/webhooks\/fichacerta\/slugNEW$/);
    expect(r.tokenUrl).toMatch(/\/api\/webhooks\/fichacerta\/slugNEW\/token$/);

    const wh = webhookMock.mock.calls[0][1];
    expect(wh.endpoint).toBe(`${r.webhookUrl}?k=secretNEW`);
    expect(wh.token_url).toBe(r.tokenUrl);
    expect(wh.token_user).toBe("fc_slugNEW");
    expect(wh.token_password).toBe("secretNEW");

    const data = accUpsert.mock.calls[0][0].create;
    expect(data.login).toBe("api@imob.com.br");
    expect(data.passwordEncrypted).toBe("enc:pw");
    expect(data.webhookTokenPasswordEncrypted).toBe("enc:secretNEW");
    expect(data.webhookQuerySecretEncrypted).toBe("enc:secretNEW");
    expect(data.fichaCertaWebhookId).toBe("7");
    expect(data.webhookProvisioned).toBe(true);
    expect(data.status).toBe("connected");
    // Nada em claro além do login.
    expect(JSON.stringify(data)).not.toContain('"pw"');
  });

  it("401/403 na validação → 400 acionável, sem persistir", async () => {
    creditsMock.mockRejectedValue(new FichaCertaError("HTTP 401", 401, { message: "x" }));
    await expect(connectFichaCertaAccount(base)).rejects.toMatchObject({
      name: "FichaCertaConnectError",
      status: 400,
    });
    expect(accUpsert).not.toHaveBeenCalled();
    expect(webhookMock).not.toHaveBeenCalled();
  });

  it("indisponibilidade na validação → 502, sem persistir", async () => {
    creditsMock.mockRejectedValue(new FichaCertaError("down", 0, null));
    await expect(connectFichaCertaAccount(base)).rejects.toMatchObject({ status: 502 });
    expect(accUpsert).not.toHaveBeenCalled();
  });

  it("falha no webhook NÃO impede a conexão (provisioned=false, card reprovisiona)", async () => {
    webhookMock.mockRejectedValue(new FichaCertaError("HTTP 500", 500, null));
    const r = await connectFichaCertaAccount(base);
    expect(r.webhookProvisioned).toBe(false);
    expect(accUpsert).toHaveBeenCalledTimes(1);
    expect(accUpsert.mock.calls[0][0].create.webhookProvisioned).toBe(false);
  });

  it("reconexão reusa slug e segredos existentes (URL/config do webhook estáveis)", async () => {
    accFind.mockResolvedValue({
      orgId: "org1",
      label: "Conta antiga",
      webhookSlug: "slugOLD",
      webhookTokenUser: "fc_slugOLD",
      webhookTokenPasswordEncrypted: "tpOLD",
      webhookTokenPasswordIvBase64: "iv",
      webhookTokenPasswordTagBase64: "tag",
      webhookQuerySecretEncrypted: "qsOLD",
      webhookQuerySecretIvBase64: "iv",
      webhookQuerySecretTagBase64: "tag",
      fichaCertaWebhookId: "3",
      webhookProvisioned: true,
      costCents: 2000,
    });
    const r = await connectFichaCertaAccount({ ...base, password: "novaSenha" });
    expect(r.webhookUrl).toMatch(/slugOLD$/);
    const wh = webhookMock.mock.calls[0][1];
    expect(wh.token_user).toBe("fc_slugOLD");
    expect(wh.token_password).toBe("dec:tpOLD");
    expect(wh.endpoint).toContain(`?k=${encodeURIComponent("dec:qsOLD")}`);
    const data = accUpsert.mock.calls[0][0].update;
    expect(data.passwordEncrypted).toBe("enc:novaSenha");
    expect(data.webhookSlug).toBe("slugOLD");
    expect(data.costCents).toBe(2000);
    expect(data.label).toBe("Conta antiga");
  });

  it("login/senha vazios → 400", async () => {
    await expect(connectFichaCertaAccount({ ...base, password: "" })).rejects.toBeInstanceOf(
      FichaCertaConnectError
    );
  });
});

describe("disconnectFichaCertaAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    accDelete.mockResolvedValue({});
  });

  it("sem conta → ok idempotente", async () => {
    accFind.mockResolvedValue(null);
    expect(await disconnectFichaCertaAccount("org1")).toEqual({ ok: true, alreadyDisconnected: true });
    expect(accDelete).not.toHaveBeenCalled();
  });

  it("com conta → tenta apagar o webhook remoto (best-effort) e apaga a row", async () => {
    accFind.mockResolvedValue({
      orgId: "org1",
      login: "l",
      passwordEncrypted: "pw",
      passwordIvBase64: "iv",
      passwordTagBase64: "tag",
      baseUrl: "https://api.fichacertadigital.com.br",
      products: "1",
      costCents: 1500,
      fichaCertaWebhookId: "9",
    });
    (deleteWebhook as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("x"));
    expect(await disconnectFichaCertaAccount("org1")).toEqual({ ok: true });
    expect(deleteWebhook).toHaveBeenCalledWith(expect.objectContaining({ login: "l" }), "9");
    expect(accDelete).toHaveBeenCalledWith({ where: { orgId: "org1" } });
  });
});
