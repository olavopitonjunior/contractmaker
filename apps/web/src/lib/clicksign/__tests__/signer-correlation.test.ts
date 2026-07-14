import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { resolveSigner } from "../webhook-process";
import type { WebhookPayload } from "../types";

const findFirst = prisma.envelopeSigner.findFirst as unknown as ReturnType<
  typeof vi.fn
>;
const findMany = prisma.envelopeSigner.findMany as unknown as ReturnType<
  typeof vi.fn
>;

// Cônjuges que compartilham o e-mail — o caso que quebrava a correlação.
const MARIA = {
  id: "s1",
  clicksignId: "key-maria",
  email: "casal@x.com",
  status: "notified",
  createdAt: new Date("2026-01-01"),
};
const JOAO = {
  id: "s2",
  clicksignId: "key-joao",
  email: "casal@x.com",
  status: "notified",
  createdAt: new Date("2026-01-02"),
};

function payload(signer: { key?: string; email?: string }): WebhookPayload {
  return {
    event: { name: "sign", data: { signer } },
  } as unknown as WebhookPayload;
}

describe("resolveSigner — correlação de signatário no webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findFirst.mockResolvedValue(null);
    findMany.mockResolvedValue([]);
  });

  it("casa pela `key` da ClickSign, não pelo e-mail", async () => {
    findFirst.mockResolvedValue(JOAO);

    const out = await resolveSigner("env1", payload({ key: "key-joao" }));

    expect(out?.id).toBe("s2");
    expect(findFirst).toHaveBeenCalledWith({
      where: { envelopeId: "env1", clicksignId: "key-joao" },
    });
    // Casou pela key → nem chega a consultar por e-mail.
    expect(findMany).not.toHaveBeenCalled();
  });

  it("dois signatários com o MESMO e-mail e keys distintas → marca o correto", async () => {
    // Este é o bug: antes, `findFirst({ envelopeId, email })` sem orderBy
    // devolvia um dos dois ao acaso.
    findFirst.mockImplementation(
      async ({ where }: { where: { clicksignId?: string } }) =>
        [MARIA, JOAO].find((s) => s.clicksignId === where.clicksignId) ?? null
    );

    const maria = await resolveSigner("env1", payload({ key: "key-maria" }));
    const joao = await resolveSigner("env1", payload({ key: "key-joao" }));

    expect(maria?.id).toBe("s1");
    expect(joao?.id).toBe("s2");
  });

  it("sem key, o fallback por e-mail é determinístico (ordena por createdAt)", async () => {
    findMany.mockResolvedValue([MARIA, JOAO]);

    const out = await resolveSigner("env1", payload({ email: "casal@x.com" }));

    expect(out?.id).toBe("s1"); // o mais antigo, não "um dos dois"
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: "asc" } })
    );
  });

  it("sem key, dois eventos `sign` marcam DOIS signatários (não reescrevem o mesmo)", async () => {
    // 1º evento: ninguém assinou ainda → pega o mais antigo.
    findMany.mockResolvedValue([MARIA, JOAO]);
    const first = await resolveSigner("env1", payload({ email: "casal@x.com" }), {
      skipStatuses: ["signed"],
    });
    expect(first?.id).toBe("s1");

    // 2º evento: Maria já assinou → tem que cair no João.
    findMany.mockResolvedValue([{ ...MARIA, status: "signed" }, JOAO]);
    const second = await resolveSigner("env1", payload({ email: "casal@x.com" }), {
      skipStatuses: ["signed"],
    });
    expect(second?.id).toBe("s2");
  });

  it("fallback por e-mail é case-insensitive e ignora espaços", async () => {
    findMany.mockResolvedValue([MARIA]);

    await resolveSigner("env1", payload({ email: "  Casal@X.com " }));

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          email: { equals: "Casal@X.com", mode: "insensitive" },
        }),
      })
    );
  });

  it("key desconhecida cai no fallback por e-mail em vez de devolver null", async () => {
    // Signatários criados antes desta correção podem não ter clicksignId.
    findFirst.mockResolvedValue(null);
    findMany.mockResolvedValue([MARIA]);

    const out = await resolveSigner(
      "env1",
      payload({ key: "key-orfa", email: "casal@x.com" })
    );

    expect(out?.id).toBe("s1");
  });

  it("sem key e sem e-mail → null (não adivinha)", async () => {
    const out = await resolveSigner("env1", payload({}));
    expect(out).toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });
});
