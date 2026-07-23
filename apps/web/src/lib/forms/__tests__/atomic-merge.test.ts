import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  prisma: { $transaction: vi.fn() },
}));

import { mergeSalesFormDataJson, FormNotFoundError } from "../atomic-merge";
import { prisma } from "@/lib/db/prisma";

const mockTransaction = vi.mocked(prisma.$transaction);

/**
 * Banco fake: uma linha de SalesForm com dataJson mutável. O $transaction
 * fake serializa as transações (fila FIFO) — como o FOR UPDATE faz no
 * Postgres — e o $queryRaw devolve a leitura FRESCA do estado atual.
 */
function setupFakeDb(initial: {
  id?: string;
  dataJson?: Record<string, unknown> | null;
  exists?: boolean;
}) {
  const db = {
    id: initial.id ?? "form-1",
    dataJson: initial.dataJson ?? {},
    status: "rascunho",
    completedAt: null as Date | null,
    privacyAcceptedAt: null as Date | null,
    updatedAt: new Date("2026-07-16T12:00:00Z"),
    exists: initial.exists ?? true,
  };

  const updateCalls: Array<Record<string, unknown>> = [];

  const tx = {
    $queryRaw: vi.fn(async () =>
      db.exists
        ? [
            {
              id: db.id,
              dataJson: db.dataJson,
              status: db.status,
              completedAt: db.completedAt,
              privacyAcceptedAt: db.privacyAcceptedAt,
            },
          ]
        : [],
    ),
    salesForm: {
      update: vi.fn(async (args: { data: Record<string, unknown> }) => {
        updateCalls.push(args.data);
        db.dataJson = args.data.dataJson as Record<string, unknown>;
        if (typeof args.data.status === "string") db.status = args.data.status;
        if (args.data.completedAt instanceof Date) {
          db.completedAt = args.data.completedAt;
        }
        return {
          id: db.id,
          status: db.status,
          updatedAt: db.updatedAt,
          completedAt: db.completedAt,
        };
      }),
    },
    salesFormParticipant: {
      update: vi.fn(async () => ({ completedAt: new Date() })),
    },
  };

  // Fila FIFO: a transação N+1 só entra quando a N termina — é exatamente a
  // serialização que o row lock (FOR UPDATE) dá em produção.
  let chain: Promise<unknown> = Promise.resolve();
  mockTransaction.mockImplementation(((fn: (t: unknown) => Promise<unknown>) => {
    const run = chain.then(() => fn(tx));
    chain = run.catch(() => {});
    return run;
  }) as never);

  return { db, tx, updateCalls };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("mergeSalesFormDataJson", () => {
  it("mergeia sobre a leitura FRESCA, não sobre a leitura do handler (anti lost-update)", async () => {
    // Cenário do bug: o handler leu o form quando `compradores` ainda não
    // existia; um subtoken gravou `compradores` depois. O save do handler
    // não pode apagar o que chegou entre a leitura e a escrita.
    const { db } = setupFakeDb({
      dataJson: {
        vendedores: [{ nome: "João" }],
        compradores: [{ nome: "Maria" }], // gravado por outro escritor
      },
    });

    const result = await mergeSalesFormDataJson({
      where: { id: "form-1" },
      incoming: { pagamento: { valor_total: 100 } },
    });

    expect(result.finalData).toEqual({
      vendedores: [{ nome: "João" }],
      compradores: [{ nome: "Maria" }],
      pagamento: { valor_total: 100 },
    });
    expect(db.dataJson).toEqual(result.finalData);
  });

  it("dois merges concorrentes em paths disjuntos: ambos os subtrees sobrevivem", async () => {
    // O teste-chave do bug: vendedor (subtoken) e operador (token principal)
    // salvando ao mesmo tempo. Com a releitura sob lock, o segundo merge parte
    // do resultado do primeiro — nada se perde, em qualquer ordem.
    const { db } = setupFakeDb({ dataJson: { config: { foro: "arbitragem" } } });

    await Promise.all([
      mergeSalesFormDataJson({
        where: { id: "form-1" },
        incoming: { vendedores: [{ nome: "João" }] },
        allowedTopKeys: ["vendedores", "imoveis"],
      }),
      mergeSalesFormDataJson({
        where: { token: "tok-1" },
        incoming: { pagamento: { valor_total: 500 } },
      }),
    ]);

    expect(db.dataJson).toEqual({
      config: { foro: "arbitragem" },
      vendedores: [{ nome: "João" }],
      pagamento: { valor_total: 500 },
    });
  });

  it("allowedTopKeys descarta chaves fora do escopo e reporta em rejectedPaths", async () => {
    const { db } = setupFakeDb({ dataJson: { comissao: { valor: 1 } } });

    const result = await mergeSalesFormDataJson({
      where: { id: "form-1" },
      incoming: {
        compradores: [{ nome: "Maria" }],
        comissao: { valor: 999 }, // comprador não pode escrever comissão
      },
      allowedTopKeys: ["compradores"],
    });

    expect(result.rejectedPaths).toEqual(["comissao"]);
    expect(db.dataJson).toEqual({
      comissao: { valor: 1 },
      compradores: [{ nome: "Maria" }],
    });
  });

  it("transform roda sobre o merged fresco e o retorno é o que persiste", async () => {
    const { db } = setupFakeDb({
      dataJson: { vendedores: [{ nome: "João" }, { nome: "João" }] },
    });

    const dedupe = (data: Record<string, unknown>) => ({
      ...data,
      vendedores: [{ nome: "João" }],
    });

    const result = await mergeSalesFormDataJson({
      where: { id: "form-1" },
      incoming: { compradores: [{ nome: "Maria" }] },
      transform: dedupe,
    });

    // `merged` é o pré-transform; `finalData` (gravado) é o pós.
    expect((result.merged.vendedores as unknown[]).length).toBe(2);
    expect((result.finalData.vendedores as unknown[]).length).toBe(1);
    expect(db.dataJson).toEqual(result.finalData);
  });

  it("extraData vai no MESMO update do dataJson", async () => {
    const { updateCalls } = setupFakeDb({ dataJson: {} });
    const completedAt = new Date("2026-07-16T21:00:00Z");

    const result = await mergeSalesFormDataJson({
      where: { token: "tok-1" },
      incoming: { compradores: [] },
      extraData: { status: "completo", completedAt },
    });

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toMatchObject({
      status: "completo",
      completedAt,
    });
    expect(result.updated.status).toBe("completo");
  });

  it("extraData como função recebe a linha FRESCA sob o lock (status atual, não stale)", async () => {
    // Cenário do finalize×auto-save: o handler leu status="rascunho", mas um
    // finalize concorrente já gravou "completo". O auto-save (sem body.status)
    // não pode regredir — decidindo contra o fresh.status, mantém "completo".
    const { db, updateCalls } = setupFakeDb({ dataJson: {} });
    db.status = "completo"; // outro escritor finalizou depois da leitura stale
    db.completedAt = new Date("2026-07-16T20:00:00Z");

    await mergeSalesFormDataJson({
      where: { id: "form-1" },
      incoming: { vendedores: [] },
      extraData: (fresh) => ({
        // simula o handler: requestedStatus undefined → mantém o fresco
        status: fresh.status,
      }),
    });

    expect(updateCalls[0]).toMatchObject({ status: "completo" });
    expect(db.status).toBe("completo");
  });

  it("also roda dentro da mesma transação, com o tx client", async () => {
    const { tx } = setupFakeDb({ dataJson: {} });
    const also = vi.fn(async (t: unknown) => {
      expect(t).toBe(tx);
    });

    await mergeSalesFormDataJson({
      where: { id: "form-1" },
      incoming: {},
      also,
    });

    expect(also).toHaveBeenCalledTimes(1);
  });

  it("form inexistente lança FormNotFoundError", async () => {
    setupFakeDb({ exists: false });

    await expect(
      mergeSalesFormDataJson({ where: { id: "nope" }, incoming: {} }),
    ).rejects.toBeInstanceOf(FormNotFoundError);
  });

  it("protectBlankPartyArrays: PATCH stale com template vazio não apaga o que o participante gravou (bug prod 2026-07-23)", async () => {
    const TEMPLATE = {
      tipo_pessoa: "fisica",
      nome: "",
      nacionalidade: "Brasileiro(a)",
      cpf: "",
      rg: "",
      email: "",
    };
    const { db } = setupFakeDb({ dataJson: {} });

    // 1) Participante (link individual) grava a própria fatia.
    await mergeSalesFormDataJson({
      where: { id: "form-1" },
      incoming: { vendedores: [{ ...TEMPLATE, nome: "Francielly", cpf: "40019343884" }] },
      allowedTopKeys: ["vendedores", "imoveis"],
      protectBlankPartyArrays: ["vendedores"],
    });

    // 2) Aba stale do token principal auto-salva o estado inteiro, com
    // vendedores ainda no template vazio do wizard.
    const result = await mergeSalesFormDataJson({
      where: { token: "tok-1" },
      incoming: {
        vendedores: [{ ...TEMPLATE }],
        pagamento: { valor_total: 100 },
      },
      protectBlankPartyArrays: ["vendedores", "compradores", "testemunhas"],
    });

    expect(result.skippedBlankArrayKeys).toEqual(["vendedores"]);
    expect(db.dataJson).toEqual({
      vendedores: [{ ...TEMPLATE, nome: "Francielly", cpf: "40019343884" }],
      pagamento: { valor_total: 100 },
    });
  });

  it("protectBlankPartyArrays: remoção legítima de parte continua passando", async () => {
    const { db } = setupFakeDb({
      dataJson: { vendedores: [{ nome: "João" }, { nome: "Ana" }] },
    });

    const result = await mergeSalesFormDataJson({
      where: { id: "form-1" },
      incoming: { vendedores: [{ nome: "João" }] },
      protectBlankPartyArrays: ["vendedores"],
    });

    expect(result.skippedBlankArrayKeys).toEqual([]);
    expect(db.dataJson).toEqual({ vendedores: [{ nome: "João" }] });
  });

  it("sem protectBlankPartyArrays o comportamento é o anterior (array substitui)", async () => {
    const { db } = setupFakeDb({ dataJson: { vendedores: [{ nome: "João" }] } });

    const result = await mergeSalesFormDataJson({
      where: { id: "form-1" },
      incoming: { vendedores: [{ nome: "" }] },
    });

    expect(result.skippedBlankArrayKeys).toEqual([]);
    expect(db.dataJson).toEqual({ vendedores: [{ nome: "" }] });
  });

  it("protectBlankPartyArrays: concorrência participante×principal em qualquer ordem preserva a fatia", async () => {
    const { db } = setupFakeDb({ dataJson: {} });

    await Promise.all([
      mergeSalesFormDataJson({
        where: { id: "form-1" },
        incoming: { vendedores: [{ nome: "Francielly", cpf: "40019343884" }] },
        allowedTopKeys: ["vendedores", "imoveis"],
        protectBlankPartyArrays: ["vendedores"],
      }),
      mergeSalesFormDataJson({
        where: { token: "tok-1" },
        incoming: {
          vendedores: [{ nome: "", cpf: "", rg: "", email: "" }],
          pagamento: { valor_total: 500 },
        },
        protectBlankPartyArrays: ["vendedores", "compradores"],
      }),
    ]);

    // Em qualquer ordem da fila FIFO: se o principal entra primeiro, o form
    // ainda está vazio e o template passa (primeiro save legítimo) — mas o
    // participante grava DEPOIS e vence. Se o participante entra primeiro, o
    // guard descarta o template do principal. Nos dois casos a fatia fica.
    expect(
      (db.dataJson as { vendedores: Array<{ nome: string }> }).vendedores[0].nome,
    ).toBe("Francielly");
    expect(
      (db.dataJson as { pagamento?: { valor_total: number } }).pagamento,
    ).toEqual({ valor_total: 500 });
  });

  it("dataJson null no banco vira base vazia (form recém-criado)", async () => {
    const { db } = setupFakeDb({ dataJson: null });

    const result = await mergeSalesFormDataJson({
      where: { id: "form-1" },
      incoming: { vendedores: [{ nome: "João" }] },
    });

    expect(result.finalData).toEqual({ vendedores: [{ nome: "João" }] });
    expect(db.dataJson).toEqual(result.finalData);
  });
});
