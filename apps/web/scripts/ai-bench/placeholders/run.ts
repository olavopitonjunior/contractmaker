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
import {
  catalogForModalidade,
  requiredTokens,
} from "../../../src/lib/templates/placeholder-catalog";
import { extractPlaceholdersFromText } from "../../../src/lib/google/replace-placeholders";
import { buildLocacaoGoogleDocsMap } from "../../../src/lib/templates/gdoc-replacement-map";
import { enrichLocacaoData } from "../../../src/lib/locacao/enrich";
import { getPreviewSampleData } from "../../../src/lib/templates/preview-sample-data";
import { CORPUS_DIR, GOLD_DIR } from "./corpus";

/**
 * Cobertura honesta: chave que um bloco composto JÁ RENDERIZA não está
 * faltando. `{{rateio_primeiro_aluguel}}` imprime a qualificação e a conta da
 * imobiliária; `{{bloco_administradora}}` imprime o dia de vencimento;
 * `{{clausula_garantia}}` (fiador) imprime a qualificação do fiador. O passe
 * recusa essas chaves como `overlapped` DE PROPÓSITO — contá-las como
 * "não cobertas" mandava consertar o que está certo (foi o que a primeira
 * medição fez: 42 `overlapped`, dos quais 34 eram exatamente isto).
 *
 * A decisão é medida, não declarada: o mapa de amostra da geração renderiza
 * cada bloco presente, e uma chave conta como coberta quando o valor que ela
 * imprimiria aparece dentro de um bloco que está no documento.
 */
function amostraMapa(modalidade: string): Record<string, string> | null {
  if (!["locacao", "locacao_comercial", "temporada"].includes(modalidade)) return null;
  const raw = getPreviewSampleData(modalidade);
  const clone = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
  try {
    return buildLocacaoGoogleDocsMap({
      enriched: enrichLocacaoData(clone, {}),
      rawDataJson: raw,
      registro: [],
      orgRecebimento: null,
      contrato: { numero: "EXEMPLO-0001", id: "exemplo", versao: "1" },
    });
  } catch {
    return null;
  }
}

function cobertasPorBloco(
  modalidade: string,
  presentes: ReadonlySet<string>
): Set<string> {
  const out = new Set<string>();
  const mapa = amostraMapa(modalidade);
  if (!mapa) return out;
  const cat = catalogForModalidade(modalidade);
  for (const bloco of cat) {
    if (bloco.kind !== "composed" || !presentes.has(bloco.token)) continue;
    const texto = mapa[bloco.token] ?? "";
    if (texto.trim().length < 20) continue;
    for (const d of cat) {
      if (d.token === bloco.token || presentes.has(d.token) || out.has(d.token)) continue;
      const valor = mapa[d.token];
      if (typeof valor !== "string" || valor.trim().length < 4) continue;
      if (texto.includes(valor)) out.add(d.token);
    }
  }
  return out;
}

const arg = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

/**
 * Cadastro fictício da imobiliária: as checagens semânticas precisam de um.
 *
 * Os valores são fictícios mas REALISTAS, e isso é requisito, não capricho. A
 * primeira versão usava `creci: "00000-J"` e `bankAccount: "00000-0"`, e os
 * cinco zeros casavam dentro de "R$ 00.000,00" — a bateria reportou três
 * defeitos `org-literal` que eram do bench, não do passe de IA. Um corpus que
 * inventa defeito é pior que corpus nenhum: manda consertar o que não está
 * quebrado.
 */
const ORG_FICTICIA = {
  legalName: "Imobiliária Exemplo Ltda",
  cnpj: "11.610.282/0001-65",
  creci: "24.342-J",
  pixAddressKey: "financeiro@exemplo.test",
  bankBranch: "3971-6",
  bankAccount: "58204-3",
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

/**
 * Casos a partir de um diretório de textos, SEM gabarito anotado.
 *
 * Anotar à mão onde cada chave deveria entrar custa horas por contrato, e para
 * a pergunta "o passe produz defeito?" existe um oráculo pronto e mais barato:
 * as próprias checagens semânticas. Elas não dizem o que FALTOU (isso só o
 * gabarito diz), mas dizem o que saiu ERRADO — que é exatamente a classe de
 * falha medida nos 16 modelos da RE/MAX Trio.
 *
 * `expected: []` deixa precisão/recall degenerados de propósito; neste modo a
 * tabela só reporta a coluna semântica, e o relatório diz isso em vez de
 * imprimir 0% como se fosse medida.
 */
function loadCorpusSemGabarito(dir: string): GoldCase[] {
  const only = arg("case");
  const index = path.join(dir, "index.json");
  const meta: Array<{ file: string; modalidade: string | null }> = fs.existsSync(index)
    ? JSON.parse(fs.readFileSync(index, "utf8"))
    : fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".txt"))
        .map((f) => ({ file: f, modalidade: null }));
  return meta
    .filter((m) => !only || m.file.startsWith(only))
    .map((m) => ({
      file: m.file,
      modalidade: m.modalidade ?? "locacao",
      expected: [],
    }));
}

(async () => {
  const corpusDir = arg("corpus-dir");
  const semGabarito = !!corpusDir;
  const gold = semGabarito ? loadCorpusSemGabarito(corpusDir!) : loadGold();
  if (gold.length === 0) {
    console.error(
      semGabarito
        ? `Nenhum .txt em ${corpusDir}.`
        : "Nenhum caso de gabarito encontrado em gold/."
    );
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
  const cobertura: Array<{
    presentes: number;
    porBloco: number;
    total: number;
    faltamObrigatorias: string[];
  }> = [];

  for (const g of gold) {
    const docText = fs.readFileSync(path.join(corpusDir ?? CORPUS_DIR, g.file), "utf8");

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
    // Cobertura: o outro lado da acurácia. "Sem defeito" não distingue um passe
    // correto de um passe que não fez nada — só esta coluna faz.
    const cat = catalogForModalidade(g.modalidade);
    const presentes = new Set(extractPlaceholdersFromText(plan.simulatedText));
    const porBloco = cobertasPorBloco(g.modalidade, presentes);
    const cobertas = new Set([...presentes, ...porBloco]);
    cobertura.push({
      presentes: cat.filter((d) => presentes.has(d.token)).length,
      porBloco: porBloco.size,
      total: cat.length,
      faltamObrigatorias: requiredTokens(g.modalidade).filter((t) => !cobertas.has(t)),
    });
  }

  if (semGabarito) {
    // Sem gabarito não há o que medir de precisão/recall: imprimir 0% ali seria
    // um número que parece medida e não é.
    console.log(
      "\ncaso                                    | chaves | falta obrig. | defeitos semânticos"
    );
    console.log("-".repeat(104));
    let comDefeito = 0;
    let somaCob = 0;
    let semObrig = 0;
    for (let i = 0; i < scores.length; i += 1) {
      const s = scores[i]!;
      const sem = Object.entries(s.semantic).filter(([, v]) => v > 0);
      if (sem.length) comDefeito += 1;
      const c = cobertura[i]!;
      somaCob += (c.presentes + c.porBloco) / Math.max(1, c.total);
      if (c.faltamObrigatorias.length === 0) semObrig += 1;
      console.log(
        s.file.replace(/\.txt$/, "").slice(0, 39).padEnd(39) +
          " | " +
          `${c.presentes}${c.porBloco ? `+${c.porBloco}` : ""}/${c.total}`.padStart(8) +
          " | " +
          String(c.faltamObrigatorias.length).padStart(12) +
          " | " +
          (sem.length ? sem.map(([k, v]) => `${k}:${v}`).join(" ") : "— limpo")
      );
    }
    console.log("-".repeat(96));
    console.log(
      `\nSEM DEFEITO: ${scores.length - comDefeito} de ${scores.length} ` +
        `(${pct((scores.length - comDefeito) / scores.length)}) — o passe não produziu erro que as regras vejam`
    );
    console.log(
      `COBERTURA:   ${pct(somaCob / scores.length)} das chaves do catálogo, em média ` +
        `("+N" = chaves que um bloco composto presente já renderiza); ` +
        `${semObrig} de ${scores.length} sem obrigatória faltando`
    );
    console.log(
      "  (as duas medem coisas diferentes: 'sem defeito' é o que saiu ERRADO,\n" +
        "   'cobertura' é o que NÃO saiu. Um passe que não chaveia nada pontua 100% na primeira.)"
    );
    const porCat: Record<string, number> = {};
    for (const s of scores) {
      for (const [k, v] of Object.entries(s.semantic)) porCat[k] = (porCat[k] ?? 0) + v;
    }
    console.log("defeitos por categoria:", Object.keys(porCat).length ? JSON.stringify(porCat) : "nenhum");
  } else {
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
  }
  const agg = aggregate(scores);
  if (!semGabarito) {
  console.log("-".repeat(96));
  console.log(
    `TOTAL${" ".repeat(18)} | ${pct(agg.precision).padStart(6)} | ${pct(agg.recall).padStart(6)} | ` +
      `${agg.tp}/${agg.fp}/${agg.fn}`.padEnd(10) +
      ` | ${String(agg.forbidden).padStart(9)} |`
  );
  }

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
