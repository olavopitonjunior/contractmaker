import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Leitura e escrita da política de capabilities do Max.
 *
 * A ordem dos blocos segue a **regra 3** da governança (`CLAUDE.md`):
 * capability nova nasce desligada, com o caso NEGADO escrito antes do
 * permitido. Se alguém inverter o default algum dia, é o primeiro bloco que
 * cai — e ele cai antes de qualquer teste de concessão passar.
 */

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    maxCapabilityPolicy: {
      findUnique: vi.fn(),
      upsert: vi.fn().mockResolvedValue({}),
    },
  },
}));

const { getMaxPolicy, setMaxPolicy, POLITICA_VAZIA } = await import("../policy");
const { prisma } = await import("@/lib/db/prisma");

const achar = prisma.maxCapabilityPolicy.findUnique as unknown as ReturnType<typeof vi.fn>;
const gravar = prisma.maxCapabilityPolicy.upsert as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => vi.clearAllMocks());

// ─── 1. NEGADO ──────────────────────────────────────────────────────────────

describe("fail-closed", () => {
  /**
   * Org sem linha e org com linha vazia são o MESMO estado do ponto de vista de
   * quem consome. Se um deles concedesse algo por omissão, o fail-closed seria
   * uma promessa que a ausência de configuração desmente.
   */
  it("org SEM linha devolve a política vazia", async () => {
    achar.mockResolvedValue(null);
    expect(await getMaxPolicy("org1")).toEqual(POLITICA_VAZIA);
  });

  it("linha com os defaults do schema devolve a política vazia", async () => {
    achar.mockResolvedValue({ byRole: {}, byRecipient: {}, brokerDefault: [] });
    expect(await getMaxPolicy("org1")).toEqual(POLITICA_VAZIA);
  });

  /**
   * Falha de LEITURA não derruba quem chama — cai no vazio, que concede nada.
   * O oposto (propagar o erro) trocaria "sem política" por "sem resposta", e
   * derrubaria o turn do agente por uma configuração que quase sempre está
   * vazia.
   */
  it("falha de banco cai no vazio, não propaga", async () => {
    achar.mockRejectedValue(new Error("connection reset"));
    expect(await getMaxPolicy("org1")).toEqual(POLITICA_VAZIA);
  });

  /**
   * A coluna é JSONB: aceita qualquer forma, inclusive a que uma versão
   * anterior ou uma edição à mão deixaram lá. Forma inesperada vira vazio, que
   * é o lado seguro — nunca um throw no caminho do turn.
   */
  it.each([
    ["string", "nada disso"],
    ["número", 42],
    ["array onde devia ser objeto", ["deal.list"]],
    ["null", null],
  ])("byRole com forma inválida (%s) vira vazio", async (_nome, valor) => {
    achar.mockResolvedValue({ byRole: valor, byRecipient: {}, brokerDefault: [] });
    expect((await getMaxPolicy("org1")).byRole).toEqual({});
  });

  it("entrada não-lista dentro de byRole é descartada", async () => {
    achar.mockResolvedValue({
      byRole: { manager: ["deal.list"], sales: "deal.list", admin: null },
      byRecipient: {},
      brokerDefault: [],
    });
    expect((await getMaxPolicy("org1")).byRole).toEqual({ manager: ["deal.list"] });
  });

  it("item não-string dentro da lista é descartado", async () => {
    achar.mockResolvedValue({
      byRole: { manager: ["deal.list", 7, null, { a: 1 }] },
      byRecipient: {},
      brokerDefault: [],
    });
    expect((await getMaxPolicy("org1")).byRole.manager).toEqual(["deal.list"]);
  });

  it("override sem allow nem deny não vira entrada vazia", async () => {
    achar.mockResolvedValue({
      byRole: {},
      byRecipient: { sr1: {}, sr2: { deny: ["deal.list"] } },
      brokerDefault: [],
    });
    expect(await getMaxPolicy("org1").then((p) => p.byRecipient)).toEqual({
      sr2: { deny: ["deal.list"] },
    });
  });
});

// ─── 2. PERMITIDO ───────────────────────────────────────────────────────────

describe("leitura de política configurada", () => {
  it("devolve as três chaves como gravadas", async () => {
    achar.mockResolvedValue({
      byRole: { manager: ["deal.list", "deal.pending"] },
      byRecipient: { sr1: { allow: ["deal.detail"], deny: ["proposal.list"] } },
      brokerDefault: ["deal.pending"],
    });

    expect(await getMaxPolicy("org1")).toEqual({
      byRole: { manager: ["deal.list", "deal.pending"] },
      byRecipient: { sr1: { allow: ["deal.detail"], deny: ["proposal.list"] } },
      brokerDefault: ["deal.pending"],
    });
  });

  /**
   * Este repo NÃO valida nome de capability, e isso é decisão, não descuido: o
   * catálogo canônico vive no `max-agent`, e uma segunda lista aqui existiria
   * para divergir. Nome desconhecido é descartado por quem lê, do outro lado.
   */
  it("não valida nome de capability — o catálogo é do outro repo", async () => {
    achar.mockResolvedValue({
      byRole: { manager: ["deal.list", "capability.do.futuro"] },
      byRecipient: {},
      brokerDefault: [],
    });
    expect((await getMaxPolicy("org1")).byRole.manager).toContain("capability.do.futuro");
  });
});

describe("escrita", () => {
  it("faz upsert — a ausência da linha é estado legítimo", async () => {
    await setMaxPolicy(
      "org1",
      { byRole: { manager: ["deal.list"] }, byRecipient: {}, brokerDefault: [] },
      "user-admin"
    );

    expect(gravar).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orgId: "org1" },
        create: expect.objectContaining({ orgId: "org1", updatedBy: "user-admin" }),
      })
    );
  });

  /** Sujeira não é gravada: o saneamento é o mesmo da leitura, num lugar só. */
  it("sanea antes de gravar", async () => {
    const r = await setMaxPolicy(
      "org1",
      {
        byRole: { manager: ["deal.list", 7 as unknown as string] },
        byRecipient: { sr1: {} },
        brokerDefault: ["deal.pending", null as unknown as string],
      },
      null
    );

    expect(r).toEqual({
      byRole: { manager: ["deal.list"] },
      byRecipient: {},
      brokerDefault: ["deal.pending"],
    });
  });
});
