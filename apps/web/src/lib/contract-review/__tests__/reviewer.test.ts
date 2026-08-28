import { describe, expect, it, vi } from "vitest";
import { StructuredOutputTruncatedError } from "@/lib/ai/shared/anthropic-structured";
import {
  buildReviewUserContent,
  renderFormSummaryText,
  renderPlanSummaryText,
  runContractReviewLlm,
  REVIEW_DOC_TEXT_CAP,
} from "../reviewer";
import { buildGenerationPlan } from "../plan";

const DOC =
  "CLÁUSULA TERCEIRA — O aluguel mensal é de R$ 2.500,00, vencível todo dia 05. " +
  "CLÁUSULA QUARTA — A garantia é o seguro fiança da Porto Seguro.";

const USAGE = { promptTokens: 1000, completionTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 500 };

function stubRunner(responses: Array<unknown | Error>) {
  let call = 0;
  return vi.fn(async () => {
    const r = responses[Math.min(call, responses.length - 1)];
    call += 1;
    if (r instanceof Error) throw r;
    return { data: r, model: "claude-sonnet-5", usage: USAGE, latencyMs: 100 };
  });
}

function baseInput(structured: ReturnType<typeof stubRunner>) {
  return {
    family: "locacao" as const,
    formSummaryText: "- Aluguel: R$ 2.300,00",
    planSummaryText: "- Template: SF",
    docText: DOC,
    existingComments: [],
    structured: structured as never,
    model: "claude-sonnet-5",
  };
}

describe("runContractReviewLlm", () => {
  it("caminho feliz: um degrau, achados validados", async () => {
    const runner = stubRunner([
      {
        documentOk: false,
        findings: [
          {
            category: "dados_form",
            severity: "warning",
            title: "Aluguel divergente",
            finding: "Form R$ 2.300 × texto R$ 2.500.",
            selectedText: "O aluguel mensal é de R$ 2.500,00",
          },
        ],
      },
    ]);
    const result = await runContractReviewLlm(baseInput(runner));
    expect(runner).toHaveBeenCalledTimes(1);
    expect(result.retried).toBe(false);
    expect(result.findings).toHaveLength(1);
    expect(result.steps).toHaveLength(1);
    // Playbook cacheável no system, dados voláteis no userContent.
    const call = runner.mock.calls[0][0] as { system: Array<{ cache?: boolean }>; userContent: string };
    expect(call.system[0].cache).toBe(true);
    expect(call.userContent).toContain("RESUMO DO NEGÓCIO");
  });

  it("JSON truncado → retry com feedback de encolher", async () => {
    const runner = stubRunner([
      new StructuredOutputTruncatedError("truncado"),
      { documentOk: true, findings: [] },
    ]);
    const result = await runContractReviewLlm(baseInput(runner));
    expect(runner).toHaveBeenCalledTimes(2);
    expect(result.retried).toBe(true);
    const secondCall = runner.mock.calls[1][0] as { userContent: string };
    expect(secondCall.userContent).toContain("FEEDBACK DA TENTATIVA ANTERIOR");
  });

  it("maioria descartada pelo guardrail → retry com as violações", async () => {
    const bad = {
      documentOk: false,
      findings: [
        {
          category: "dados_form",
          severity: "warning",
          title: "Inventado",
          finding: "x",
          selectedText: "trecho que não existe no contrato de jeito nenhum",
        },
      ],
    };
    const good = {
      documentOk: false,
      findings: [
        {
          category: "dados_form",
          severity: "warning",
          title: "Real",
          finding: "x",
          selectedText: "O aluguel mensal é de R$ 2.500,00",
        },
      ],
    };
    const runner = stubRunner([bad, good]);
    const result = await runContractReviewLlm(baseInput(runner));
    expect(runner).toHaveBeenCalledTimes(2);
    expect(result.retried).toBe(true);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].title).toBe("Real");
    const secondCall = runner.mock.calls[1][0] as { userContent: string };
    expect(secondCall.userContent).toContain("não é citação literal");
  });

  it("erro que não é truncamento propaga (o executor devolve o run ao sweeper)", async () => {
    const runner = stubRunner([new Error("api down")]);
    await expect(runContractReviewLlm(baseInput(runner))).rejects.toThrow("api down");
  });
});

describe("builders de prompt", () => {
  it("renderFormSummaryText formata seções e linhas", () => {
    const text = renderFormSummaryText([
      { title: "Garantia locatícia", rows: [{ label: "Tipo", value: "Seguro fiança" }] },
    ]);
    expect(text).toContain("### Garantia locatícia");
    expect(text).toContain("- Tipo: Seguro fiança");
  });

  it("renderPlanSummaryText resume plano com fallback e falhas", () => {
    const plan = buildGenerationPlan({
      family: "locacao",
      template: { id: "t", name: "Padrão Residencial", engine: "google_docs", modalidade: "locacao" },
      manualTemplate: false,
      garantiaMatched: false,
      dataJson: { garantia: { tipo: "seguro_fianca", provider: "Pottencial" } },
      slots: {
        values: {},
        resolved: [{ slot: "garantia", value: "seguro_fianca", source: "fallback" }],
        failures: [{ slot: "garantia", reason: "provider_mismatch", message: "x" }],
      },
    });
    const text = renderPlanSummaryText(plan);
    expect(text).toContain("FALLBACK");
    expect(text).toContain("Pottencial");
    expect(text).toContain("provider_mismatch");
    expect(renderPlanSummaryText(null)).toContain("sem plano de geração");
  });

  it("corta o texto do contrato no teto com aviso", () => {
    const content = buildReviewUserContent({
      formSummaryText: "f",
      planSummaryText: "p",
      existingComments: [],
      docText: "x".repeat(REVIEW_DOC_TEXT_CAP + 100),
    });
    expect(content).toContain("TEXTO CORTADO NO LIMITE");
    expect(content.length).toBeLessThan(REVIEW_DOC_TEXT_CAP + 1000);
  });
});
