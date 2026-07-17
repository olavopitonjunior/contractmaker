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
    updatedAt: new Date("2026-07-16T12:00:00Z"),
    exists: initial.exists ?? true,
  };

  const updateCalls: Array<Record<string, unknown>> = [];

  const tx = {
    $queryRaw: vi.fn(async () =>
      db.exists ? [{ id: db.id, dataJson: db.dataJson }] : [],
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
