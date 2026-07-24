import { describe, it, expect, vi, beforeEach } from "vitest";

const { surveyTemplateFindFirst, surveyResponseFindMany } = vi.hoisted(() => ({
  surveyTemplateFindFirst: vi.fn(),
  surveyResponseFindMany: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    surveyTemplate: { findFirst: surveyTemplateFindFirst, update: vi.fn() },
    surveyResponse: { findMany: surveyResponseFindMany },
  },
}));

import { buildSummaryInput, redactPii } from "./summary";

const QUESTIONS = [
  { id: "nps", type: "nps", label: "Recomendaria?", required: true },
  { id: "obs", type: "text", label: "Observações", required: false },
  { id: "extra", type: "text", label: "Mais algo?", required: false },
];

function makeResponse(
  answers: Array<{ questionId: string; type: string; value: unknown }>,
  scores: { npsScore?: number | null; csatScore?: number | null } = {}
) {
  return {
    answersJson: answers,
    npsScore: scores.npsScore ?? null,
    csatScore: scores.csatScore ?? null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  surveyTemplateFindFirst.mockResolvedValue({ questionsJson: QUESTIONS });
});

describe("buildSummaryInput", () => {
  it("coleta só respostas de texto não-vazias, com prefixo de notas", async () => {
    surveyResponseFindMany.mockResolvedValue([
      makeResponse(
        [
          { questionId: "nps", type: "nps", value: 3 },
          { questionId: "obs", type: "text", value: "Demorou demais" },
        ],
        { npsScore: 3 }
      ),
      makeResponse([{ questionId: "obs", type: "text", value: "   " }]),
      makeResponse([{ questionId: "nps", type: "nps", value: 9 }], { npsScore: 9 }),
    ]);

    const input = await buildSummaryInput("org-1", "tpl-1");
    expect(input).not.toBeNull();
    expect(input!.textResponseCount).toBe(1);
    expect(input!.entries).toEqual(["[NPS 3] Demorou demais"]);
  });

  it("conta múltiplas perguntas de texto da mesma resposta", async () => {
    surveyResponseFindMany.mockResolvedValue([
      makeResponse(
        [
          { questionId: "obs", type: "text", value: "Bom atendimento" },
          { questionId: "extra", type: "text", value: "Nada a acrescentar" },
        ],
        { csatScore: 5 }
      ),
    ]);
    const input = await buildSummaryInput("org-1", "tpl-1");
    expect(input!.textResponseCount).toBe(2);
    expect(input!.entries).toHaveLength(2);
    expect(input!.entries[0]).toContain("[CSAT 5]");
  });

  it("hash é estável pro mesmo conteúdo e muda com resposta nova", async () => {
    const base = [
      makeResponse([{ questionId: "obs", type: "text", value: "Ótimo" }], {
        npsScore: 10,
      }),
    ];
    surveyResponseFindMany.mockResolvedValue(base);
    const a = await buildSummaryInput("org-1", "tpl-1");
    surveyResponseFindMany.mockResolvedValue(base);
    const b = await buildSummaryInput("org-1", "tpl-1");
    expect(a!.hash).toBe(b!.hash);

    surveyResponseFindMany.mockResolvedValue([
      ...base,
      makeResponse([{ questionId: "obs", type: "text", value: "Péssimo" }], {
        npsScore: 1,
      }),
    ]);
    const c = await buildSummaryInput("org-1", "tpl-1");
    expect(c!.hash).not.toBe(a!.hash);
  });

  it("aplica cap de 100 entradas (mantém as mais recentes)", async () => {
    surveyResponseFindMany.mockResolvedValue(
      Array.from({ length: 120 }, (_, i) =>
        makeResponse([{ questionId: "obs", type: "text", value: `Resposta ${i}` }])
      )
    );
    const input = await buildSummaryInput("org-1", "tpl-1");
    expect(input!.textResponseCount).toBe(120);
    expect(input!.entries).toHaveLength(100);
    expect(input!.entries[99]).toContain("Resposta 119");
  });

  it("template inexistente retorna null", async () => {
    surveyTemplateFindFirst.mockResolvedValue(null);
    expect(await buildSummaryInput("org-1", "nope")).toBeNull();
  });

  it("redige PII antes de montar o prompt", async () => {
    surveyResponseFindMany.mockResolvedValue([
      makeResponse([
        {
          questionId: "obs",
          type: "text",
          value:
            "Meu CPF é 123.456.789-00, me liguem no (11) 91234-5678 ou joao@exemplo.com",
        },
      ]),
    ]);
    const input = await buildSummaryInput("org-1", "tpl-1");
    expect(input!.entries[0]).toContain("[CPF]");
    expect(input!.entries[0]).toContain("[telefone]");
    expect(input!.entries[0]).toContain("[e-mail]");
    expect(input!.entries[0]).not.toContain("123.456.789-00");
    expect(input!.entries[0]).not.toContain("91234-5678");
    expect(input!.entries[0]).not.toContain("joao@exemplo.com");
  });
});

describe("redactPii", () => {
  it("preserva números curtos legítimos", () => {
    expect(redactPii("Apartamento de 3 quartos, prazo de 45 dias")).toBe(
      "Apartamento de 3 quartos, prazo de 45 dias"
    );
  });

  it("redige CNPJ e telefone com DDI", () => {
    const out = redactPii("Empresa 12.345.678/0001-90, tel +55 11 98765-4321");
    expect(out).toContain("[CNPJ]");
    expect(out).toContain("[telefone]");
  });
});
