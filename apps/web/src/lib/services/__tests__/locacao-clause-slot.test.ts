import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db/prisma";

/**
 * Integração do SLOT DE CLÁUSULA na geração de contrato de locação.
 *
 * O que este arquivo trava (é o caminho onde um erro vira contrato assinado com
 * a garantia errada):
 *   - template COM slot + garantia com cláusula no acervo → a cláusula do acervo
 *     entra no contrato;
 *   - template COM slot + garantia SEM cláusula → fallback da condicional
 *     canônica (nunca sai buraco);
 *   - template SEM slot (todos os canônicos) → nada muda e o acervo nem é
 *     consultado.
 *
 * O Google Docs fica DESLIGADO (`isGoogleDocsFeatureEnabled: false`): o objeto
 * de teste é o `dataJson` persistido no Contract, que é de onde todo re-render
 * posterior (export, diff, memória) tira o texto do slot.
 */

// Handlebars real — sem ele o htmlContent/valor do slot vira JSON e não dá pra
// afirmar nada sobre o texto da cláusula.
vi.mock("@/lib/render/handlebars", async () =>
  vi.importActual("@/lib/render/handlebars")
);

vi.mock("@/lib/google/client", () => ({
  isGoogleDocsFeatureEnabled: () => false,
  isGoogleDocsConfigured: () => false,
}));
vi.mock("@/lib/modules/guard", () => ({ assertModuleEnabled: vi.fn() }));
vi.mock("@/lib/modules/resolve", () => ({ getPipelineByKind: vi.fn(async () => null) }));
vi.mock("@/lib/locacao/create-lease-contract", () => ({
  createLeaseContractFromDataJson: vi.fn(),
}));
vi.mock("@/lib/notifications/deal-events", () => ({ notifyDealEvent: vi.fn() }));
// Org sem padrão próprio → padrão de fábrica (o mesmo que a rota real devolve).
vi.mock("@/lib/contracts/org-defaults", async () => {
  const { DEFAULT_CONTRACT_SETTINGS, DEFAULT_LOCACAO_SETTINGS } = await import(
    "@/lib/contracts/default-config"
  );
  return {
    loadOrgContractDefaults: vi.fn(async () => DEFAULT_CONTRACT_SETTINGS),
    loadOrgLocacaoDefaults: vi.fn(async () => DEFAULT_LOCACAO_SETTINGS),
  };
});
vi.mock("@vercel/functions", () => ({ waitUntil: vi.fn() }));

import { generateLocacaoContractForDeal } from "../contract-generation";
import { slotMarkerHandlebars } from "@/lib/templates/clause-slots";

// Delegates que o mock global do Prisma não declara (esta é a primeira suíte a
// exercitar a criação de contrato de ponta a ponta). Escritos no MESMO objeto
// que o `$transaction` do setup entrega como `tx` — por isso valem dentro e
// fora da transação.
const dealFindUniqueOrThrow = vi.fn();
const contractAggregate = vi.fn();
const contractCreate = vi.fn();
const contractUpdateMany = vi.fn();
Object.assign(prisma.deal, { findUniqueOrThrow: dealFindUniqueOrThrow });
Object.assign(prisma.contract, {
  aggregate: contractAggregate,
  create: contractCreate,
  updateMany: contractUpdateMany,
});

const dealUpdate = prisma.deal.update as unknown as ReturnType<typeof vi.fn>;
const templateFindMany = prisma.contractTemplate.findMany as unknown as ReturnType<
  typeof vi.fn
>;
const orgFindUnique = prisma.organization.findUnique as unknown as ReturnType<
  typeof vi.fn
>;
const kiFindMany = prisma.knowledgeItem.findMany as unknown as ReturnType<typeof vi.fn>;

/** dataJson do form de locação com fiador (a garantia que o form escolheu). */
function leaseData(garantia: Record<string, unknown>) {
  return {
    locadores: [{ tipo_pessoa: "fisica", nome: "Ana", cpf: "11122233344" }],
    locatarios: [{ tipo_pessoa: "fisica", nome: "Bruno", cpf: "55566677788" }],
    imovel: { rua: "Rua X", numero: "10", cidade: "Curitiba", uf: "PR" },
    aluguel: { valor: 2500, dia_vencimento: 5, prazo_meses: 30 },
    garantia,
  };
}

const SLOT_TEMPLATE = {
  id: "tpl-slot",
  name: "Locação RE/MAX (família)",
  engine: "handlebars",
  status: "active",
  isDefault: true,
  modalidade: "locacao",
  matchCriteria: null,
  // A base comum consolidada: texto fixo + o marcador no lugar da cláusula que
  // variava entre os arquivos.
  handlebarsSource: `<h1>LOCAÇÃO</h1><p>CLÁUSULA OITAVA - DA GARANTIA</p>${slotMarkerHandlebars(
    "garantia"
  )}<p>CLÁUSULA NONA - DO FORO</p>`,
};

const CANONICAL_TEMPLATE = {
  ...SLOT_TEMPLATE,
  id: "tpl-canonico",
  name: "Locação Residencial",
  handlebarsSource: `<h1>LOCAÇÃO</h1><p>Texto do canônico sem slot nenhum.</p>`,
};

async function generate() {
  return generateLocacaoContractForDeal("deal1", "user1", "org1");
}

function createdDataJson(): Record<string, unknown> {
  return contractCreate.mock.calls[0][0].data.dataJson as Record<string, unknown>;
}

function createdHtml(): string {
  return contractCreate.mock.calls[0][0].data.htmlContent as string;
}

describe("generateLocacaoContractForDeal — slot de cláusula", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dealFindUniqueOrThrow.mockResolvedValue({
      id: "deal1",
      title: "Locação",
      value: null,
      form: { dataJson: leaseData({ tipo: "caucao", caucao_meses: 3 }), schemaType: "locacao_residencial_v1" },
    });
    dealUpdate.mockResolvedValue({});
    orgFindUnique.mockResolvedValue({ name: "Org", legalName: null });
    contractAggregate.mockResolvedValue({ _max: { version: 0 } });
    contractUpdateMany.mockResolvedValue({ count: 0 });
    contractCreate.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
      id: "contract1",
      version: 1,
      ...args.data,
    }));
    templateFindMany.mockResolvedValue([SLOT_TEMPLATE]);
    kiFindMany.mockResolvedValue([]);
  });

  it("cláusula do acervo com a tag da garantia escolhida entra no contrato", async () => {
    kiFindMany.mockResolvedValue([
      {
        id: "ki-caucao",
        content:
          "<p>8.1. Caução de {{garantia.caucao_meses}} aluguéis — redação da RE/MAX.</p>",
      },
    ]);

    await generate();

    expect(kiFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          orgId: "org1",
          category: "clause",
          status: "approved",
          tags: { hasEvery: ["slot:garantia", "garantia:caucao"] },
        }),
      })
    );
    expect(createdDataJson().slot_garantia).toContain("redação da RE/MAX");
    expect(createdHtml()).toContain("Caução de 3 aluguéis — redação da RE/MAX");
  });

  it("garantia SEM cláusula no acervo cai na condicional embutida do canônico", async () => {
    kiFindMany.mockResolvedValue([]);

    await generate();

    const html = createdHtml();
    expect(html).toContain("a título de caução");
    expect(html).toContain("art. 38 da Lei nº 8.245/91");
    // O slot nunca sai vazio — senão o contrato ia sem cláusula de garantia.
    expect(String(createdDataJson().slot_garantia).trim().length).toBeGreaterThan(0);
  });

  it("a cláusula do acervo é escolhida pela garantia DO FORM, não pela do modelo", async () => {
    dealFindUniqueOrThrow.mockResolvedValue({
      id: "deal1",
      title: "Locação",
      value: null,
      form: {
        dataJson: leaseData({
          tipo: "fiador",
          fiador: { tipo_pessoa: "fisica", nome: "Carlos", cpf: "99988877766" },
        }),
        schemaType: "locacao_residencial_v1",
      },
    });
    kiFindMany.mockResolvedValue([
      { id: "ki-fiador", content: "<p>8.1. Fiança solidária — redação da casa.</p>" },
    ]);

    await generate();

    expect(kiFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tags: { hasEvery: ["slot:garantia", "garantia:fiador"] },
        }),
      })
    );
    expect(createdHtml()).toContain("Fiança solidária — redação da casa");
  });

  it("REGRESSÃO: template SEM slot não consulta o acervo e sai igual a antes", async () => {
    templateFindMany.mockResolvedValue([CANONICAL_TEMPLATE]);

    await generate();

    expect(kiFindMany).not.toHaveBeenCalled();
    expect(createdDataJson()).not.toHaveProperty("slot_garantia");
    expect(createdHtml()).toBe(
      "<h1>LOCAÇÃO</h1><p>Texto do canônico sem slot nenhum.</p>"
    );
  });

  /**
   * P-1 — a cláusula do acervo é renderizada contra o dataJson JÁ ENRIQUECIDO,
   * então tudo que o enrich derrama em `config` (padrão da org > padrão de
   * fábrica) está disponível dentro dela. Honorários advocatícios é o caso que
   * quase passou batido: o enrich propaga por loop genérico sobre
   * `settings.config`, e uma cláusula de garantia real cita o percentual.
   */
  it("P-1: config.honorarios_advocaticios_percent chega ao render da cláusula do slot", async () => {
    kiFindMany.mockResolvedValue([
      {
        id: "ki-honorarios",
        content:
          "<p>8.2. Em caso de cobrança judicial incidirão honorários advocatícios de {{config.honorarios_advocaticios_percent}}% sobre o débito.</p>",
      },
    ]);

    await generate();

    expect(createdDataJson().slot_garantia).toContain("honorários advocatícios de 10%");
    expect(createdHtml()).toContain("honorários advocatícios de 10%");
    // A trava anti-resíduo só passa se a chave virou valor de verdade.
    expect(createdHtml()).not.toContain("{{");
  });

  it("cláusula com Handlebars quebrado NÃO derruba a geração — sai o fallback canônico", async () => {
    kiFindMany.mockResolvedValue([
      { id: "ki-quebrada", content: "<p>{{#if garantia.tipo}}bloco sem fechar</p>" },
    ]);

    await generate();

    const html = createdHtml();
    expect(html).toContain("a título de caução");
    expect(html).not.toContain("{{");
    expect(String(createdDataJson().slot_garantia).trim().length).toBeGreaterThan(0);
  });

  it("o valor do slot fica no dataJson — re-render (export/diff) não reconsulta o acervo", async () => {
    kiFindMany.mockResolvedValue([
      { id: "ki-caucao", content: "<p>Cláusula persistida.</p>" },
    ]);

    await generate();

    const data = createdDataJson();
    expect(data.slot_garantia).toContain("Cláusula persistida.");
    // Mesma chave que o template consome — é o contrato entre as duas pontas.
    expect(createdHtml()).toContain("Cláusula persistida.");
  });
});
