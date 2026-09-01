import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildClassifyUserContent,
  createLlmItemClassifier,
  CLASSIFICATION_SCHEMA,
  CLASSIFY_PLAYBOOK,
} from "@/lib/ingestion/llm-classifier";
import { precomputeItemSignals } from "@/lib/ingestion/classifier";
import { IngestionAiMeter, IngestionCostCapError } from "@/lib/ingestion/ai-budget";
import type {
  StructuredCallInput,
  StructuredCallResult,
} from "@/lib/ai/shared/anthropic-structured";
import type { UploadClassification } from "@/lib/knowledge/upload-classifier";

const CORPUS = join(
  __dirname,
  "..",
  "..",
  "templates",
  "__tests__",
  "fixtures",
  "ativa-residencial"
);

const PORTO = readFileSync(join(CORPUS, "03-RES-PORTO-SEGURO.txt"), "utf8");

const UPLOAD: UploadClassification = {
  kind: "template",
  confidence: 0.93,
  reason: "Estrutura de contrato completo.",
};

interface RawOut {
  docType: unknown;
  subOption: unknown;
  modalidade: unknown;
  garantiaTipo: unknown;
  provider: unknown;
  admImobiliaria: unknown;
  isFilledInstance: unknown;
  piiEntities: unknown;
  confidence: unknown;
  reason: unknown;
}

/** Runner falso — NENHUM teste toca a API de verdade. */
function fakeRunner(data: Partial<RawOut>, usage = { prompt: 4_000, completion: 200 }) {
  const calls: StructuredCallInput[] = [];
  const fn = vi.fn(
    async <T,>(input: StructuredCallInput): Promise<StructuredCallResult<T>> => {
      calls.push(input);
      return {
        data: data as T,
        model: input.model,
        usage: {
          promptTokens: usage.prompt,
          completionTokens: usage.completion,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
        latencyMs: 12,
      };
    }
  );
  return { fn: fn as never, calls };
}

const OK: Partial<RawOut> = {
  docType: "contrato_locacao",
  subOption: "residencial",
  modalidade: "locacao",
  garantiaTipo: "seguro_fianca",
  provider: "Porto Seguro",
  isFilledInstance: true,
  piiEntities: [],
  confidence: 0.93,
  reason: "Contrato de locação residencial garantido por seguro-fiança.",
};

function input(text = PORTO, filename = "03-RES-PORTO-SEGURO.docx") {
  return { filename, text, upload: UPLOAD };
}

describe("classificador LLM — o essencial", () => {
  it("marca via=llm e devolve os valores canônicos", async () => {
    const runner = fakeRunner(OK);
    const { classification } = await createLlmItemClassifier({
      structured: runner.fn,
    }).classify(input());

    expect(classification.via).toBe("llm");
    expect(classification.docType).toBe("contrato_locacao");
    expect(classification.modalidade).toBe("locacao");
    expect(classification.garantiaTipo).toBe("seguro_fianca");
    expect(classification.familyKey).toBe("contrato_locacao:locacao:seguro_fianca");
    expect(classification.confidence).toBeCloseTo(0.93);
  });

  it("provider sai como RÓTULO humano — quem slugifica é o executor", async () => {
    const runner = fakeRunner(OK);
    const { classification } = await createLlmItemClassifier({
      structured: runner.fn,
    }).classify(input());
    expect(classification.provider).toBe("Porto Seguro");
    expect(classification.isFilledInstance).toBe(true);
  });

  it("não manda sampling param e cacheia o prefixo estável", async () => {
    const runner = fakeRunner(OK);
    await createLlmItemClassifier({ structured: runner.fn }).classify(input());

    const call = runner.calls[0];
    expect(call.effort).toBe("low");
    expect(call.system).toHaveLength(1);
    expect(call.system[0].cache).toBe(true);
    // O documento é volátil e por isso fica FORA do system — senão cada item do
    // lote invalidaria o prefixo cacheado.
    expect(call.system[0].text).not.toContain("LOCADOR: JOÃO");
    expect(call.userContent).toContain("PALPITE DETERMINÍSTICO");
    expect(JSON.stringify(call)).not.toContain("temperature");
  });

  it("o prompt leva o palpite determinístico e os trechos de garantia", () => {
    const content = buildClassifyUserContent(input());
    const signals = precomputeItemSignals(input());
    expect(content).toContain(`docType: ${signals.docType}`);
    expect(content).toContain("TRECHOS QUE FALAM DE GARANTIA");
    expect(content).toContain("Fiança Locatícia");
  });
});

describe("classificador LLM — divergência com a heurística", () => {
  it("o LLM prevalece, mas a divergência é registrada", async () => {
    // A heurística lê o TÍTULO e o recorte de garantia; aqui ela erraria a
    // garantia porque o texto só cita a modalidade de passagem.
    const texto = [
      "CONTRATO DE LOCAÇÃO PARA FINS RESIDENCIAIS",
      "Cláusula primeira: o LOCADOR dá em locação o imóvel ao LOCATÁRIO.",
      "Cláusula décima: a garantia desta locação é prestada por fiador solidário.",
      "E por estarem justos e contratados, firmam o presente em duas vias.",
    ].join("\n");

    const signals = precomputeItemSignals(input(texto, "contrato.docx"));
    expect(signals.garantiaTipo).toBe("fiador");

    const runner = fakeRunner({ ...OK, garantiaTipo: "caucao" });
    const { classification } = await createLlmItemClassifier({
      structured: runner.fn,
    }).classify(input(texto, "contrato.docx"));

    expect(classification.garantiaTipo).toBe("caucao");
    expect(classification.conflicts).toEqual([
      { field: "garantiaTipo", heuristic: "fiador", llm: "caucao" },
    ]);
  });

  it("sem divergência, a lista de conflitos sai vazia", async () => {
    const runner = fakeRunner(OK);
    const { classification } = await createLlmItemClassifier({
      structured: runner.fn,
    }).classify(input());
    expect(classification.conflicts).toEqual([]);
  });
});

describe("classificador LLM — enums fechados", () => {
  it("valor fora da taxonomia vira null, não vaza para a família", async () => {
    const runner = fakeRunner({
      ...OK,
      docType: "contrato_de_gaveta",
      garantiaTipo: "fianca_bancaria",
      modalidade: "locacao_rural",
    });
    const { classification } = await createLlmItemClassifier({
      structured: runner.fn,
    }).classify(input());

    expect(classification.docType).toBeNull();
    expect(classification.modalidade).toBeNull();
    expect(classification.garantiaTipo).toBeNull();
  });

  it("modalidade incoerente com o tipo cai na derivada da taxonomia", async () => {
    const runner = fakeRunner({ ...OK, modalidade: "a_vista" });
    const { classification } = await createLlmItemClassifier({
      structured: runner.fn,
    }).classify(input());
    expect(classification.modalidade).toBe("locacao");
  });

  it("garantia em documento que não tem o eixo é ignorada", async () => {
    // "fiador" no meio de um contrato de compra e venda é ruído — a mesma
    // guarda que `precomputeItemSignals` já aplica.
    const runner = fakeRunner({
      ...OK,
      docType: "contrato_venda",
      subOption: "a_vista",
      modalidade: "a_vista",
      garantiaTipo: "fiador",
    });
    const { classification } = await createLlmItemClassifier({
      structured: runner.fn,
    }).classify(input());
    expect(classification.garantiaTipo).toBeNull();
  });

  it("confiança ausente ou fora de [0,1] é normalizada", async () => {
    const semNumero = fakeRunner({ ...OK, confidence: "muito alta" });
    const a = await createLlmItemClassifier({ structured: semNumero.fn }).classify(
      input()
    );
    expect(a.classification.confidence).toBe(0.5);

    const acima = fakeRunner({ ...OK, confidence: 7 });
    const b = await createLlmItemClassifier({ structured: acima.fn }).classify(input());
    expect(b.classification.confidence).toBe(1);
  });
});

describe("classificador LLM — PII de nome e endereço", () => {
  it("as entidades do LLM viram findings por busca literal", async () => {
    const texto =
      "LOCATÁRIO: MARIA LOCATÁRIA TESTE, residente na Rua das Palmeiras Fictícias, nº. 250.";
    const runner = fakeRunner({
      ...OK,
      piiEntities: [
        { kind: "person_name", excerpt: "MARIA LOCATÁRIA TESTE" },
        { kind: "address", excerpt: "Rua das Palmeiras Fictícias, nº. 250" },
      ],
    });
    const { piiReport } = await createLlmItemClassifier({
      structured: runner.fn,
    }).classify(input(texto, "x.docx"));

    expect(piiReport.byKind.person_name).toBe(1);
    expect(piiReport.byKind.address).toBe(1);
    // O relatório conta, nunca guarda o valor.
    expect(JSON.stringify(piiReport)).not.toContain("MARIA");
  });

  it("categoria fora de nome/endereço é descartada", async () => {
    const runner = fakeRunner({
      ...OK,
      piiEntities: [
        { kind: "cpf", excerpt: "111.222.333-96" },
        { kind: "person_name", excerpt: "" },
        { kind: "person_name", excerpt: "JOÃO LOCADOR TESTE" },
      ],
    });
    const { piiReport } = await createLlmItemClassifier({
      structured: runner.fn,
    }).classify(input("JOÃO LOCADOR TESTE mora aqui.", "x.docx"));
    expect(piiReport.byKind.person_name).toBe(1);
  });

  it("o CPF real do corpus continua sendo pego pelo detector determinístico", async () => {
    const runner = fakeRunner({ ...OK, piiEntities: [] });
    const { piiReport } = await createLlmItemClassifier({
      structured: runner.fn,
    }).classify(input());
    expect(piiReport.byKind.cpf).toBeGreaterThan(0);
  });
});

describe("classificador LLM — custo", () => {
  it("registra a chamada como ingest_classify e acumula no run", async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    const meter = new IngestionAiMeter({ runId: "r", orgId: "o", persist });
    const runner = fakeRunner(OK);

    await createLlmItemClassifier({ structured: runner.fn, meter }).classify(input());

    expect(meter.spentUsd).toBeGreaterThan(0);
    expect(persist).toHaveBeenCalledWith("r", meter.spentUsd);
  });

  it("com o teto estourado, nem chega a chamar o modelo", async () => {
    const meter = new IngestionAiMeter({
      runId: "r",
      orgId: "o",
      spentUsd: 9,
      capUsd: 5,
      persist: vi.fn(),
    });
    const runner = fakeRunner(OK);

    await expect(
      createLlmItemClassifier({ structured: runner.fn, meter }).classify(input())
    ).rejects.toBeInstanceOf(IngestionCostCapError);
    expect(runner.calls).toHaveLength(0);
  });
});

/**
 * Eixo Administração × Não Administração. No lote de 51 da RE/MAX Trio
 * (2026-09-01) o planner colapsou os quadrantes porque a cláusula de pagamento
 * não caiu no índice de blocos — o classificador, que lê o documento inteiro,
 * é quem tem a evidência. Só o contrato de locação carrega o eixo.
 */
describe("classificador LLM — eixo de administração", () => {
  it("true quando a imobiliária administra; false no pagamento direto", async () => {
    const adm = await createLlmItemClassifier({
      structured: fakeRunner({ ...OK, admImobiliaria: true }).fn,
    }).classify(input());
    expect(adm.classification.admImobiliaria).toBe(true);

    const direta = await createLlmItemClassifier({
      structured: fakeRunner({ ...OK, admImobiliaria: false }).fn,
    }).classify(input());
    expect(direta.classification.admImobiliaria).toBe(false);
  });

  it("null quando o texto não decide — e nunca vira false por omissão", async () => {
    const semCampo = await createLlmItemClassifier({
      structured: fakeRunner({ ...OK }).fn,
    }).classify(input());
    expect(semCampo.classification.admImobiliaria).toBeNull();

    const explicito = await createLlmItemClassifier({
      structured: fakeRunner({ ...OK, admImobiliaria: null }).fn,
    }).classify(input());
    expect(explicito.classification.admImobiliaria).toBeNull();
  });

  it("valor que não é booleano ('sim') não marca o eixo", async () => {
    const r = await createLlmItemClassifier({
      structured: fakeRunner({ ...OK, admImobiliaria: "sim" }).fn,
    }).classify(input());
    expect(r.classification.admImobiliaria).toBeNull();
  });

  it("fora do contrato de locação o eixo é ignorado, mesmo que o modelo afirme", async () => {
    const venda = await createLlmItemClassifier({
      structured: fakeRunner({
        ...OK,
        docType: "contrato_venda",
        subOption: "a_vista",
        modalidade: "a_vista",
        garantiaTipo: null,
        admImobiliaria: true,
      }).fn,
    }).classify(input());
    expect(venda.classification.admImobiliaria).toBeNull();
  });

  it("o schema pede o campo (required) como união boolean|null sem enum", () => {
    const schema = CLASSIFICATION_SCHEMA as { required: string[]; properties: Record<string, { type: unknown; enum?: unknown }> };
    expect(schema.required).toContain("admImobiliaria");
    expect(schema.properties.admImobiliaria.type).toEqual(["boolean", "null"]);
    expect(schema.properties.admImobiliaria.enum).toBeUndefined();
  });

  it("o playbook explica o eixo pela cláusula de pagamento, não pela corretagem", () => {
    expect(CLASSIFY_PLAYBOOK).toContain("## admImobiliaria");
    expect(CLASSIFY_PLAYBOOK).toContain("geridos pela ADMINISTRADORA");
    expect(CLASSIFY_PLAYBOOK).toContain("corretagem sozinha não faz true");
  });
});
