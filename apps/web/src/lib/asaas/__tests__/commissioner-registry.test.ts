import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { createCommissioner } from "../commissioner-registry";

const create = prisma.splitRecipient.create as unknown as ReturnType<typeof vi.fn>;

/** Retorna o `data` passado ao prisma.create da última chamada. */
function lastCreateData(): Record<string, unknown> {
  return create.mock.calls.at(-1)![0].data as Record<string, unknown>;
}

const INPUT = {
  nome: "Sandra Lie Yamamoto",
  cpf: "123.456.789-01",
  tipo_pessoa: "fisica" as const,
  email: "sandra@imob.com",
  creci: "199.905",
  papel: "captador",
};

describe("createCommissioner — meio de recebimento define o rascunho", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
      id: "rec-novo",
      pendingFields: args.data.pendingFields,
      ...args.data,
    }));
  });

  it("sem nada: rascunho asaas_wallet inativo", async () => {
    await createCommissioner("org-1", INPUT);
    const data = lastCreateData();
    expect(data.recipientType).toBe("asaas_wallet");
    expect(data.pendingFields).toEqual(["walletId"]);
    expect(data.active).toBe(false);
  });

  it("com chave PIX: pix_external ativo, pronto pro split", async () => {
    await createCommissioner("org-1", INPUT, {
      pix: {
        chave: "sandra@imob.com",
        keyType: "EMAIL",
        titularNome: "Sandra Lie Yamamoto",
        titularCpfCnpj: "12345678901",
      },
    });
    const data = lastCreateData();
    expect(data.recipientType).toBe("pix_external");
    expect(data.pixAddressKey).toBe("sandra@imob.com");
    expect(data.pendingFields).toEqual([]);
    expect(data.active).toBe(true);
  });

  it("só conta bancária: dados gravados, mas SEGUE rascunho", async () => {
    // TED não é canal de split — `composeSplits` só entende walletId e
    // pixAddressKey. Um `asaas_wallet` ativo com walletId nulo entraria no
    // seletor do wizard e a cobrança quebraria no Asaas.
    await createCommissioner("org-1", INPUT, {
      banco: {
        nome: "Itaú",
        agencia: "0001",
        conta: "12345-6",
        tipoConta: "corrente",
        titularNome: "Sandra Lie Yamamoto",
        titularDoc: "123.456.789-01",
      },
    });
    const data = lastCreateData();
    expect(data.bankName).toBe("Itaú");
    expect(data.bankAccount).toBe("12345-6");
    expect(data.bankAccountType).toBe("corrente");
    expect(data.walletId).toBeNull();
    expect(data.pendingFields).toEqual(["walletId"]);
    expect(data.active).toBe(false);
  });

  it("PIX + banco: ativo pelo PIX, banco guardado pro repasse manual", async () => {
    await createCommissioner("org-1", INPUT, {
      pix: { chave: "12345678901", keyType: "CPF" },
      banco: { nome: "Itaú", agencia: "0001", conta: "12345-6" },
    });
    const data = lastCreateData();
    expect(data.recipientType).toBe("pix_external");
    expect(data.active).toBe(true);
    expect(data.bankName).toBe("Itaú");
  });

  it("banco parcial não é descartado", async () => {
    await createCommissioner("org-1", INPUT, {
      banco: { nome: "Itaú", agencia: "0001" },
    });
    const data = lastCreateData();
    expect(data.bankName).toBe("Itaú");
    expect(data.bankBranch).toBe("0001");
    expect(data.bankAccount).toBeNull();
  });
});
