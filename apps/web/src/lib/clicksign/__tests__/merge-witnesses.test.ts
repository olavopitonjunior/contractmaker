import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { mergeDefaultWitnesses } from "../executor";

const witFind = prisma.defaultWitness.findMany as unknown as ReturnType<
  typeof vi.fn
>;

describe("mergeDefaultWitnesses — testemunhas padrão forçadas no servidor", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sem testemunhas padrão → lista inalterada", async () => {
    witFind.mockResolvedValue([]);
    const signers = [{ name: "A", email: "a@x.com" }];
    expect(await mergeDefaultWitnesses("org", signers)).toEqual(signers);
  });

  it("anexa testemunha padrão como sourceKind=testemunha role=witness", async () => {
    witFind.mockResolvedValue([
      { nome: "Test", email: "t@x.com", cpf: "111", mobilePhone: null, isDefault: true },
    ]);
    const out = await mergeDefaultWitnesses("org", [
      { name: "A", email: "a@x.com" },
    ]);
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({
      name: "Test",
      email: "t@x.com",
      sourceKind: "testemunha",
      role: "witness",
    });
  });

  it("deduplica por e-mail (case-insensitive) e por CPF", async () => {
    witFind.mockResolvedValue([
      { nome: "Dup email", email: "A@X.com", cpf: null, mobilePhone: null },
      { nome: "Dup cpf", email: "outro@x.com", cpf: "123.456", mobilePhone: null },
      { nome: "Nova", email: "nova@x.com", cpf: "999", mobilePhone: null },
    ]);
    const out = await mergeDefaultWitnesses("org", [
      { name: "A", email: "a@x.com", documentation: "000" },
      { name: "B", email: "b@x.com", documentation: "123456" },
    ]);
    // Só "Nova" entra (as outras colidem por email/cpf).
    expect(out.map((s) => s.name)).toEqual(["A", "B", "Nova"]);
  });

  it("ignora testemunha padrão sem e-mail (não dá pra notificar)", async () => {
    witFind.mockResolvedValue([
      { nome: "Sem email", email: "", cpf: "1", mobilePhone: null },
    ]);
    const out = await mergeDefaultWitnesses("org", [{ name: "A", email: "a@x.com" }]);
    expect(out).toHaveLength(1);
  });
});
