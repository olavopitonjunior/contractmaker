import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { createCommissioner, findCommissionerMatch } from "../commissioner-registry";

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

  it("com chave PIX de origem confiavel: pix_external ativo, pronto pro split", async () => {
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

  it("chave PIX de origem ANONIMA: grava a chave mas NAO nasce pagavel", async () => {
    // Rede de seguranca. Na rota publica o dado de recebimento de nao-membro
    // ja e descartado antes de chegar aqui, entao este caminho so vale se
    // algum caller anonimo novo aparecer passando extras.
    await createCommissioner(
      "org-1",
      INPUT,
      { pix: { chave: "atacante@pix.com", keyType: "EMAIL" } },
      { unverifiedSource: true }
    );
    const data = lastCreateData();
    expect(data.pixAddressKey).toBe("atacante@pix.com");
    expect(data.active).toBe(false);
    // Nao-vazio importa duas vezes: splitDispatcher pula, e deal-brokers.ts
    // (`active || pendingFields.length > 0`) mantem o corretor recebendo aviso.
    expect(data.pendingFields).toEqual(["pixAddressKey"]);
  });

  it("origem anonima sem PIX: continua o rascunho de sempre", async () => {
    await createCommissioner("org-1", INPUT, undefined, {
      unverifiedSource: true,
    });
    const data = lastCreateData();
    expect(data.pendingFields).toEqual(["walletId"]);
    expect(data.active).toBe(false);
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

/**
 * O "Não, é outra" do diálogo de duplicidade precisa sobreviver ao servidor.
 *
 * O POST refaz o match server-side — de propósito, porque é ele que fecha a
 * corrida entre duas abas. Mas sem a lista de recusados ele reencontrava, pelo
 * e-mail, exatamente o cadastro que o usuário acabara de recusar e devolvia
 * `existed: true`: a linha ficava vinculada a quem o humano disse não ser.
 * Achado no smoke de staging em 28/08 — nenhum teste pegava.
 */
describe("findCommissionerMatch — recusa do usuário no diálogo", () => {
  const findFirst = prisma.splitRecipient.findFirst as unknown as ReturnType<typeof vi.fn>;
  const findMany = prisma.splitRecipient.findMany as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    findFirst.mockResolvedValue(null);
    findMany.mockResolvedValue([]);
  });

  const INPUT_SEM_DOC = {
    nome: "Outra Imobiliaria Homonima",
    email: "smoke@imob.com",
    tipo_pessoa: "juridica" as const,
  };

  it("e-mail e telefone passam a excluir os ids recusados", async () => {
    await findCommissionerMatch("org-1", INPUT_SEM_DOC, { ignorarIds: ["rec-recusado"] });
    const wheres = findFirst.mock.calls.map((c) => c[0].where);
    const porEmail = wheres.find((w) => "email" in w);
    expect(porEmail).toMatchObject({ id: { notIn: ["rec-recusado"] } });
  });

  it("a varredura por nome também exclui os recusados", async () => {
    await findCommissionerMatch("org-1", INPUT_SEM_DOC, { ignorarIds: ["rec-recusado"] });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { notIn: ["rec-recusado"] } }),
      })
    );
  });

  it("o DOCUMENTO ignora a recusa — mesmo CPF/CNPJ é a mesma pessoa", async () => {
    // Recusar não pode virar porta para duplicar o mesmo documento; o partial
    // unique do banco barraria de qualquer forma, e falhar aqui é mais claro.
    await findCommissionerMatch(
      "org-1",
      { ...INPUT_SEM_DOC, cnpj: "11.222.333/0001-81" },
      { ignorarIds: ["rec-recusado"] }
    );
    const porDoc = findFirst.mock.calls
      .map((c) => c[0].where)
      .find((w) => "cpfCnpj" in w);
    expect(porDoc).toBeDefined();
    expect(porDoc).not.toHaveProperty("id");
  });

  it("sem recusa, nenhum filtro de id é acrescentado", async () => {
    await findCommissionerMatch("org-1", INPUT_SEM_DOC);
    for (const c of findFirst.mock.calls) expect(c[0].where).not.toHaveProperty("id");
  });
});
