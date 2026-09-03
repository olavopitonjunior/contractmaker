/**
 * Bateria de avaliação do passe de inserção de chaves.
 *
 * Responde COM NÚMERO a pergunta que até aqui era respondida por inspeção de
 * lote: quanto do que deveria virar chave virou, e quanto do que virou está no
 * lugar errado. Foi a falta desse número que deixou 10 dos 16 modelos da Trio
 * passarem na validação sintática e chegarem errados na revisão.
 *
 * Três etapas, cada uma isolável (ver `ai-placeholder-insertion.ts`):
 *   proposeMapeamentos  → custa dinheiro, fala com a Anthropic
 *   planInsertion       → puro, é o que se pontua
 *   runSemanticChecks   → puro, conta os defeitos por categoria
 *
 * Nada aqui escreve no Google Docs: a pontuação roda sobre o texto SIMULADO
 * que o planejador produz. Um erro de planejamento é visível sem gastar uma
 * escrita no Drive, e sem depender do Drive estar de pé.
 *
 * Uso:
 *   ANTHROPIC_API_KEY=sk-... npx tsx scripts/ai-bench/placeholders/run.ts
 *   npx tsx scripts/ai-bench/placeholders/run.ts --case=02-RES-SEM-FIANCA
 *   npx tsx scripts/ai-bench/placeholders/run.ts --replay=results-2026-09-03.json
 *
 * `--replay` reprocessa o PLANEJADOR contra respostas já pagas: mudou uma
 * trava, você remede tudo em segundos e a zero. É o modo que se usa no dia a
 * dia; a rodada com modelo só quando o prompt muda.
 */
import fs from "fs";
import path from "path";
import {
  planInsertion,
  proposeMapeamentos,
} from "../../../src/lib/templates/ai-placeholder-insertion";
import { runSemanticChecks } from "../../../src/lib/templates/semantic-checks";
import { SONNET_MODEL } from "../../../src/lib/ai/shared/anthropic-client";
import { calcCostUsd } from "../../../src/lib/ai/usage";
import {
  aggregate,
  scoreInsertion,
  type CaseScore,
  type GoldCase,
} from "../../../src/lib/templates/eval/insertion-score";
import { CORPUS_DIR, GOLD_DIR } from "./corpus";

const arg = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

/** Cadastro fictício da imobiliária: as checagens semânticas precisam de um. */
const ORG_FICTICIA = {
  legalName: "Imobiliária Exemplo Ltda",
  cnpj: "11.610.282/0001-65",
  creci: "00000-J",
  pixAddressKey: "financeiro@exemplo.test",
  bankBranch: "0001-0",
  bankAccount: "00000-0",
};

interface RunRecord {
  file: string;
  modalidade: string;
  /** Resposta CRUA da IA — é o que o `--replay` reaproveita. */
  raw: string;
  mapeamentos: Array<{ token?: string; trecho_literal?: string }>;
  docTruncated: boolean;
  responseTruncated: boolean;
  responseUnparsed: boolean;
  /** Tokens da chamada que gerou este registro (0 em replay). */
  usage: { promptTokens: number; completionTokens: number; latencyMs: number };
}

function loadGold(): GoldCase[] {
  const only = arg("case");
  return fs
    .readdirSync(GOLD_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(GOLD_DIR, f), "utf8")) as GoldCase)
    .filter((g) => !only || g.file.startsWith(only));
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

(async () => {
  const gold = loadGold();
  if (gold.length === 0) {
    console.error("Nenhum caso de gabarito encontrado em gold/.");
    process.exit(1);
  }

  const replayFile = arg("replay");
  const replay: RunRecord[] | null = replayFile
    ? (JSON.parse(fs.readFileSync(path.resolve(replayFile), "utf8")).records as RunRecord[])
    : null;
  if (!replay && !process.env.ANTHROPIC_API_KEY) {
    console.error("Sem ANTHROPIC_API_KEY e sem --replay: nada a fazer.");
    process.exit(1);
  }

  const records: RunRecord[] = [];
  const scores: CaseScore[] = [];

  for (const g of gold) {
    const docText = fs.readFileSync(path.join(CORPUS_DIR, g.file), "utf8");

    let record = replay?.find((r) => r.file === g.file);
    if (!record) {
      const proposal = await proposeMapeamentos({
        docText,
        modalidade: g.modalidade,
        // Fora de qualquer org: a linha de `AIUsage` é pulada (o FK recusaria
        // um id inventado, e custo de bench dentro da métrica de um tenant
        // seria pior que não gravar). A conta sai aqui, pela mesma tabela
        // PRICING do runtime.
        orgId: null,
      });
      record = {
        file: g.file,
        modalidade: g.modalidade,
        raw: proposal.raw,
        mapeamentos: proposal.mapeamentos,
        docTruncated: proposal.docTruncated,
        responseTruncated: proposal.responseTruncated,
        responseUnparsed: proposal.responseUnparsed,
        usage: proposal.usage,
      };
    }
    records.push(record);

    const plan = planInsertion({
      docText,
      modalidade: g.modalidade,
      mapeamentos: record.mapeamentos,
    });
    const semantic = runSemanticChecks({
      docText: plan.simulatedText,
      modalidade: g.modalidade,
      org: ORG_FICTICIA,
      sourceText: docText,
    });
    scores.push(
      scoreInsertion({ gold: g, simulatedText: plan.simulatedText, plan, semantic: semantic.findings })
    );
  }

  console.log("\ncaso                    | prec.  | recall | tp/fp/fn   | proibidas | semântica");
  console.log("-".repeat(96));
  for (const s of scores) {
    const sem = Object.entries(s.semantic)
      .map(([k, v]) => `${k}:${v}`)
      .join(" ") || "—";
    console.log(
      [
        s.file.padEnd(23),
        pct(s.precision).padStart(6),
        pct(s.recall).padStart(6),
        `${s.tp}/${s.fp}/${s.fn}`.padEnd(10),
        String(s.forbiddenHits.length).padStart(9),
        sem,
      ].join(" | ")
    );
  }
  const agg = aggregate(scores);
  console.log("-".repeat(96));
  console.log(
    `TOTAL${" ".repeat(18)} | ${pct(agg.precision).padStart(6)} | ${pct(agg.recall).padStart(6)} | ` +
      `${agg.tp}/${agg.fp}/${agg.fn}`.padEnd(10) +
      ` | ${String(agg.forbidden).padStart(9)} |`
  );

  // O que o passe DESCARTOU, somado — é onde se lê se uma trava está apertada
  // demais (muito `ambiguous`) ou se o prompt está propondo lixo.
  const skipped: Record<string, number> = {};
  for (const s of scores) {
    for (const [k, v] of Object.entries(s.skipped)) skipped[k] = (skipped[k] ?? 0) + v;
  }
  console.log(
    "\ndescartes do planejador:",
    Object.keys(skipped).length ? JSON.stringify(skipped) : "nenhum"
  );

  // Chaves que mais faltaram — a lista acionável para mexer no prompt.
  const fnPorToken: Record<string, number> = {};
  for (const s of scores) {
    for (const [token, t] of Object.entries(s.perToken)) {
      if (t.fn > 0) fnPorToken[token] = (fnPorToken[token] ?? 0) + t.fn;
    }
  }
  const piores = Object.entries(fnPorToken).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (piores.length) {
    console.log("chaves que mais faltaram:", piores.map(([t, n]) => `${t}(${n})`).join(", "));
  }

  // Custo da rodada, pela MESMA tabela do runtime. Sem isto a bateria seria
  // uma chamada de modelo sem conta em lugar nenhum.
  const custo = records.reduce(
    (acc, r) =>
      acc + calcCostUsd(SONNET_MODEL, r.usage?.promptTokens ?? 0, r.usage?.completionTokens ?? 0),
    0
  );
  const latencia = records.reduce((acc, r) => acc + (r.usage?.latencyMs ?? 0), 0);
  const chamadas = records.filter((r) => !replay?.some((p) => p.file === r.file)).length;
  // Em replay o custo dos registros reaproveitados JÁ FOI PAGO; anunciá-lo como
  // "desta rodada" faria o número mentir na direção mais cara.
  console.log(
    chamadas === 0
      ? `custo desta rodada: US$ 0,0000 (replay puro; US$ ${custo.toFixed(4)} já pagos na rodada original)`
      : `custo desta rodada: US$ ${custo.toFixed(4)} em ${chamadas} chamada(s), ${(latencia / 1000).toFixed(1)}s`
  );

  const stamp = process.env.BENCH_STAMP ?? new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const out = path.join(__dirname, `results-${stamp}.json`);
  fs.writeFileSync(out, JSON.stringify({ stamp, records, scores, aggregate: agg }, null, 2));
  console.log(`\nresultado em ${path.relative(process.cwd(), out)}`);
  console.log(
    replay
      ? "(rodada em REPLAY — nenhuma chamada de modelo)"
      : "(rodada com modelo — use --replay neste arquivo para remedir o planejador de graça)"
  );
})();
