/**
 * Benchmark de modelos LLM para extração de dados de contrato.
 *
 * Compara uma MATRIZ de modelos (Anthropic + Gemini, extensível a outros
 * providers) no mesmo conjunto de casos, medindo:
 *   - acurácia campo-a-campo (quantos campos esperados o modelo acertou)
 *   - latência (ms)
 *   - custo estimado (US$) via a mesma tabela PRICING do runtime
 *
 * Objetivo: decidir com NÚMERO qual modelo usar por operação, em vez de por
 * intuição. Hoje o roteamento (Editor=Sonnet, OCR/extração=Gemini Flash) é um
 * palpite razoável — este harness confirma ou refuta.
 *
 * Uso:
 *   ANTHROPIC_API_KEY=... GEMINI_API_KEY=... \
 *     npx tsx scripts/ai-bench/run.ts [--models=haiku,sonnet,gemini-flash]
 *
 * Gasto: cada caso × cada modelo = 1 chamada. Com 2 casos e 3 modelos = 6
 * chamadas baratas. Expanda fixtures/extraction.json com CCVs reais ANONIMIZADOS
 * pra um número confiável.
 *
 * Saída: tabela no console + results-<timestamp>.json (passe o timestamp via
 * env BENCH_STAMP porque scripts não podem usar Date.now() no runtime do
 * workflow — aqui é script solto, Date é permitido).
 */
import fs from "fs";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { calcCostUsd } from "../../src/lib/ai/usage";
import {
  HAIKU_MODEL,
  SONNET_MODEL,
  OPUS_MODEL,
} from "../../src/lib/ai/shared/models";

interface ModelSpec {
  key: string;
  provider: "anthropic" | "gemini";
  model: string;
}

const MODELS: ModelSpec[] = [
  { key: "haiku", provider: "anthropic", model: HAIKU_MODEL },
  { key: "sonnet", provider: "anthropic", model: SONNET_MODEL },
  { key: "opus", provider: "anthropic", model: OPUS_MODEL },
  { key: "gemini-flash", provider: "gemini", model: "gemini-2.5-flash" },
  { key: "gemini-flash-lite", provider: "gemini", model: "gemini-2.5-flash-lite" },
];

const EXTRACT_PROMPT = (input: string) =>
  `Extraia os dados do contrato abaixo como JSON puro (sem markdown). Campos: ` +
  `modalidade ("a_vista"|"financiamento"), vendedor_nome, vendedor_cpf (só dígitos), ` +
  `comprador_nome, comprador_cpf (só dígitos), valor_total (número), e os demais ` +
  `valores monetários que aparecerem (sinal, saldo, entrada, financiado) como números.\n\n` +
  `CONTRATO:\n${input}\n\nJSON:`;

function parseJson(text: string): Record<string, unknown> | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

/** Compara campo a campo. Strings: case-insensitive trim. Números: igualdade. */
function scoreFields(
  expected: Record<string, unknown>,
  got: Record<string, unknown> | null
): { hits: number; total: number } {
  const keys = Object.keys(expected);
  let hits = 0;
  for (const k of keys) {
    const e = expected[k];
    const g = got?.[k];
    if (typeof e === "number") {
      if (typeof g === "number" && Math.abs(e - g) < 0.01) hits++;
    } else {
      if (
        typeof g === "string" &&
        g.trim().toLowerCase() === String(e).trim().toLowerCase()
      )
        hits++;
    }
  }
  return { hits, total: keys.length };
}

async function callAnthropic(
  client: Anthropic,
  model: string,
  prompt: string
): Promise<{ text: string; promptTok: number; completionTok: number }> {
  const res = await client.messages.create({
    model,
    max_tokens: 1024,
    temperature: 0,
    messages: [{ role: "user", content: prompt }],
  });
  const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  return {
    text,
    promptTok: res.usage?.input_tokens ?? 0,
    completionTok: res.usage?.output_tokens ?? 0,
  };
}

async function callGemini(
  client: GoogleGenAI,
  model: string,
  prompt: string
): Promise<{ text: string; promptTok: number; completionTok: number }> {
  const res = await client.models.generateContent({
    model,
    contents: prompt,
    config: { temperature: 0 },
  });
  const usage = (res as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } })
    .usageMetadata;
  return {
    text: res.text ?? "",
    promptTok: usage?.promptTokenCount ?? 0,
    completionTok: usage?.candidatesTokenCount ?? 0,
  };
}

async function main() {
  const arg = process.argv.find((a) => a.startsWith("--models="));
  const only = arg ? arg.slice("--models=".length).split(",") : null;
  const models = only ? MODELS.filter((m) => only.includes(m.key)) : MODELS;

  const fixturesPath = path.join(__dirname, "fixtures", "extraction.json");
  const fixtures = JSON.parse(fs.readFileSync(fixturesPath, "utf8")) as {
    cases: Array<{ id: string; input: string; expected: Record<string, unknown> }>;
  };

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const anthropic = anthropicKey ? new Anthropic({ apiKey: anthropicKey }) : null;
  const gemini = geminiKey ? new GoogleGenAI({ apiKey: geminiKey }) : null;

  type Agg = { hits: number; total: number; ms: number; cost: number; runs: number };
  const agg: Record<string, Agg> = {};

  for (const spec of models) {
    if (spec.provider === "anthropic" && !anthropic) {
      console.warn(`skip ${spec.key}: ANTHROPIC_API_KEY ausente`);
      continue;
    }
    if (spec.provider === "gemini" && !gemini) {
      console.warn(`skip ${spec.key}: GEMINI_API_KEY ausente`);
      continue;
    }
    agg[spec.key] = { hits: 0, total: 0, ms: 0, cost: 0, runs: 0 };

    for (const c of fixtures.cases) {
      const prompt = EXTRACT_PROMPT(c.input);
      const t0 = Date.now();
      try {
        const out =
          spec.provider === "anthropic"
            ? await callAnthropic(anthropic!, spec.model, prompt)
            : await callGemini(gemini!, spec.model, prompt);
        const ms = Date.now() - t0;
        const parsed = parseJson(out.text);
        const { hits, total } = scoreFields(c.expected, parsed);
        const cost = calcCostUsd(spec.model, out.promptTok, out.completionTok);
        const a = agg[spec.key];
        a.hits += hits;
        a.total += total;
        a.ms += ms;
        a.cost += cost;
        a.runs++;
        console.log(
          `${spec.key.padEnd(18)} ${c.id.padEnd(24)} ${hits}/${total} campos · ${ms}ms · $${cost.toFixed(5)}`
        );
      } catch (err) {
        console.error(`${spec.key} ${c.id} ERRO:`, err instanceof Error ? err.message : err);
      }
    }
  }

  console.log("\n=== RESUMO (média por caso) ===");
  console.log("modelo".padEnd(18), "acurácia", "  lat.méd", "  custo/1k casos");
  for (const [key, a] of Object.entries(agg)) {
    if (a.runs === 0) continue;
    const acc = ((a.hits / a.total) * 100).toFixed(1);
    const latAvg = Math.round(a.ms / a.runs);
    const costPer1k = ((a.cost / a.runs) * 1000).toFixed(2);
    console.log(
      key.padEnd(18),
      `${acc}%`.padStart(8),
      `${latAvg}ms`.padStart(9),
      `$${costPer1k}`.padStart(14)
    );
  }
  console.log(
    "\nRecomendação: escolha o modelo com a melhor acurácia dentro do orçamento " +
      "de latência/custo aceitável PARA A OPERAÇÃO. Extração tolera latência alta " +
      "(background), então acurácia domina; chat interativo pesa latência."
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
