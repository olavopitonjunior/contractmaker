/**
 * Bench de VISÃO — compara modelos no OCR real de documento brasileiro.
 *
 * Diferente do `run.ts`, que manda TEXTO e mede extração sobre texto já
 * legível: aqui vai o binário (`inlineData`) e o `COMBINED_PROMPT` DE PRODUÇÃO,
 * exercitando o mesmo caminho que o formulário exercita.
 *
 * ── Os braços, e por que são seis ────────────────────────────────────────
 *
 * O ponto do desenho é SEPARAR duas variáveis que mudariam juntas se o bench
 * fosse ingênuo: o modelo e o `responseSchema`. Sem os braços 1 e 2, um ganho
 * do schema apareceria como mérito do modelo novo, e trocaríamos de modelo
 * quando bastava consertar a chamada.
 *
 *   1. gemini-2.5-flash SEM schema  → baseline exato de produção hoje
 *   2. gemini-2.5-flash COM schema  → isola o ganho do schema sozinho
 *   3. gemini-3.5-flash-lite        → candidato
 *   4. gemini-3.1-flash-lite        → candidato (mais barato)
 *   5. gemma-4-31b-it               → candidato (grátis)
 *
 * Falta um sexto braço, de DUAS ETAPAS (classificar e depois extrair com o
 * schema exato da categoria), para responder se o objeto superset numa chamada
 * é mesmo o melhor formato. Ele depende dos schemas por categoria, que nascem
 * junto com o `OCR_RESPONSE_SCHEMA` de produção — ou seja, depois deste bench.
 * Enquanto não existir, a pergunta do formato segue em aberto, e vale dizer
 * isso em vez de fingir que os cinco braços a respondem.
 *
 * ── Custo ────────────────────────────────────────────────────────────────
 *
 * Usa `geminiUsageToTokens`, que soma `thoughtsTokenCount` ao completion. Sem
 * isso o `gemini-2.5-flash` apareceria com ~1/5 do custo de output real — e
 * este é justamente o relatório que decide a troca de modelo, ou seja, o lugar
 * onde subcontar enviesa a decisão.
 *
 * ── Uso ──────────────────────────────────────────────────────────────────
 *
 *   cd apps/web
 *   GEMINI_API_KEY=... npx tsx scripts/ai-bench/run-vision.ts [--repeticoes=3]
 *     [--modelos=baseline,schema,gemma]
 *
 * Ou, pelo entrypoint único: `npx tsx scripts/ai-bench/run.ts --vision`
 */
import fs from "fs";
import path from "path";
import { GoogleGenAI } from "@google/genai";
import { calcCostUsd, geminiUsageToTokens } from "../../src/lib/ai/usage";
import type { GeminiUsageMetadata } from "../../src/lib/ai/usage";
import { COMBINED_PROMPT } from "../../src/lib/ai/ocr";
import {
  agregar,
  avaliar,
  compararCampos,
  type PlacarDocumento,
} from "../../src/lib/ai/bench/vision-scoring";

const FIXTURES = path.join(__dirname, "fixtures", "vision");
const DOCS = path.join(FIXTURES, "docs");
const GABARITO = path.join(FIXTURES, "ground-truth.json");

interface Braco {
  chave: string;
  modelo: string;
  comSchema: boolean;
  rotulo: string;
}

const BRACOS: Braco[] = [
  { chave: "baseline", modelo: "gemini-2.5-flash", comSchema: false, rotulo: "2.5-flash (produção hoje)" },
  { chave: "schema", modelo: "gemini-2.5-flash", comSchema: true, rotulo: "2.5-flash + schema" },
  { chave: "lite35", modelo: "gemini-3.5-flash-lite", comSchema: true, rotulo: "3.5-flash-lite + schema" },
  { chave: "lite31", modelo: "gemini-3.1-flash-lite", comSchema: true, rotulo: "3.1-flash-lite + schema" },
  { chave: "gemma", modelo: "gemma-4-31b-it", comSchema: true, rotulo: "gemma-4-31b + schema" },
];

const CATEGORIAS = [
  "rg", "cpf", "cnh", "matricula", "iptu", "escritura", "procuracao",
  "comprovante_residencia", "certidao_casamento", "ficha_resumo", "outro",
];

/**
 * Campos planos do `COMBINED_PROMPT`, em união. **Declarar `properties` não é
 * detalhe:** medido em 24/08, um `campos: { type: "OBJECT" }` sem properties
 * NÃO dá erro — devolve `campos: {}` VAZIO, em silêncio. Todos os braços com
 * schema reportariam 100% de omissão e 0% de alucinação, e o critério de veto
 * do bench nunca dispararia. O harness produziria um número confiante e
 * completamente errado, que é o pior modo de falha possível aqui.
 */
const CAMPOS_DO_PROMPT = [
  "nome_completo", "rg_numero", "orgao_expedidor", "data_nascimento", "sexo",
  "naturalidade", "filiacao_mae", "filiacao_pai", "conjuge_nome", "conjuge_cpf",
  "cpf_numero", "situacao_cadastral", "categoria", "data_emissao",
  "data_validade", "registro_cnh", "matricula_numero", "cartorio",
  "endereco_completo", "bairro", "cidade", "uf", "cep", "proprietario_nome",
  "area_total", "onus_existentes", "descricao_imovel", "inscricao_iptu",
  "inscricao_municipal", "sql", "endereco", "valor_venal", "ano_referencia",
  "debitos_pendentes", "vendedor_nome", "comprador_nome", "valor_transacao",
  "data_lavratura", "endereco_imovel", "matricula_referenciada",
  "outorgante_nome", "outorgante_cpf", "outorgado_nome", "outorgado_cpf",
  "poderes_resumo", "prazo_validade", "titular_nome", "emissor",
  "conjuge1_nome", "conjuge1_cpf", "conjuge2_nome", "conjuge2_cpf",
  "data_casamento", "regime_bens", "tipo_documento",
];

/**
 * Schema de saída espelhando o `COMBINED_PROMPT`. Não importa o
 * `OCR_RESPONSE_SCHEMA` de produção de propósito: ele ainda não existe (nasce
 * no PR do structured output), e o bench precisa rodar ANTES para justificá-lo.
 *
 * O `enum` em `tipo` é o segundo ponto — sem ele, medido em 24/08, o
 * 3.5-flash-lite devolveu "matricula_imovel" e o 3.1 devolveu "Matrícula de
 * Imóvel", que o `parseGeminiJson` rebaixaria a "outro".
 */
function schemaDeSaida() {
  const properties: Record<string, unknown> = {};
  for (const k of CAMPOS_DO_PROMPT) {
    properties[k] = { type: "STRING", nullable: true };
  }
  return {
    type: "OBJECT",
    properties: {
      tipo: { type: "STRING", enum: CATEGORIAS },
      campos: { type: "OBJECT", properties },
      confidence: { type: "NUMBER" },
    },
    required: ["tipo", "campos", "confidence"],
  };
}

/**
 * Mesma normalização de categoria que o `parseGeminiJson` de produção faz.
 * O braço `baseline` roda SEM enum e é o mais propenso a devolver "RG" ou
 * "Matrícula" — aceitos em produção, e que um `===` cru marcaria como erro.
 */
function normalizarCategoria(tipo: unknown): string {
  const t = typeof tipo === "string" ? tipo.trim().toLowerCase() : "";
  return CATEGORIAS.includes(t) ? t : "outro";
}

/** Argumento numérico com validação — `Number("tres")` é NaN, e `r < NaN` é false. */
function argInteiro(nome: string, padrao: number): number {
  const bruto = arg(nome);
  if (bruto === null) return padrao;
  const n = Number(bruto);
  if (!Number.isInteger(n) || n <= 0) {
    console.error(`--${nome} precisa ser inteiro positivo (recebi ${JSON.stringify(bruto)}).`);
    process.exit(1);
  }
  return n;
}

/** O MESMO parser tolerante de produção (`parseGeminiJson`). */
function parseTolerante(texto: string): Record<string, unknown> | null {
  const m = texto.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function arg(nome: string): string | null {
  const p = process.argv.find((a) => a.startsWith(`--${nome}=`));
  return p ? p.slice(nome.length + 3) : null;
}

async function main() {
  if (!fs.existsSync(GABARITO)) {
    console.error(
      `Gabarito não encontrado em ${GABARITO}.\n` +
        `Rode antes:\n  npx tsx scripts/ai-bench/pull-fixtures.ts --org=<id> --confirmo-o-banco=<nome>\n` +
        `e preencha o campo \`esperado\` de cada caso conferindo contra o documento.`
    );
    process.exit(1);
  }

  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) {
    console.error("GEMINI_API_KEY ausente.");
    process.exit(1);
  }

  const { casos } = JSON.parse(fs.readFileSync(GABARITO, "utf8")) as {
    casos: Array<{
      id: string;
      arquivo: string;
      mime: string;
      categoriaSugerida: string | null;
      /** Categoria conferida À MÃO. Sem ela, a métrica de categoria é omitida. */
      categoriaEsperada?: string | null;
      esperado: Record<string, unknown>;
      falhouEmProducao: boolean;
    }>;
  };

  const anotados = casos.filter((c) => Object.keys(c.esperado).length > 0);
  if (anotados.length === 0) {
    console.error(
      `Nenhum caso tem gabarito preenchido.\n` +
        `Os ${casos.length} casos estão com \`esperado\` vazio. O bench mediria\n` +
        `concordância com o modelo atual, não acurácia — que é exatamente o\n` +
        `viés que este harness existe para evitar.`
    );
    process.exit(1);
  }
  if (anotados.length < casos.length) {
    console.warn(
      `${casos.length - anotados.length} caso(s) sem gabarito — ignorados. ` +
        `Rodando com ${anotados.length}.`
    );
  }

  const repeticoes = argInteiro("repeticoes", 3);
  const filtro = arg("modelos")?.split(",") ?? null;
  const bracos = filtro ? BRACOS.filter((b) => filtro.includes(b.chave)) : BRACOS;

  const ai = new GoogleGenAI({ apiKey: key });
  const resultados: Record<string, PlacarDocumento[]> = {};
  const falhas: Record<string, number> = {};

  console.log(
    `${anotados.length} documento(s) × ${bracos.length} braço(s) × ${repeticoes} repetição(ões) ` +
      `= ${anotados.length * bracos.length * repeticoes} chamadas.\n`
  );

  for (const braco of bracos) {
    resultados[braco.chave] = [];
    for (const caso of anotados) {
      const bytes = fs.readFileSync(path.join(DOCS, caso.arquivo));
      const base64 = bytes.toString("base64");

      for (let r = 0; r < repeticoes; r++) {
        const t0 = Date.now();
        let texto = "";
        let usage: GeminiUsageMetadata | undefined;
        try {
          const res = await ai.models.generateContent({
            model: braco.modelo,
            contents: [
              { text: COMBINED_PROMPT },
              { inlineData: { mimeType: caso.mime, data: base64 } },
            ],
            ...(braco.comSchema
              ? {
                  config: {
                    responseMimeType: "application/json",
                    responseSchema: schemaDeSaida(),
                  },
                }
              : {}),
          });
          texto = res.text ?? "";
          usage = (res as { usageMetadata?: GeminiUsageMetadata }).usageMetadata;
        } catch (err) {
          // Falha é RESULTADO MEDIDO, não caso a ignorar. Descartá-la fazia um
          // modelo que estoura rate limit em metade do corpus reportar a mesma
          // acurácia de um que respondeu tudo — e ser aprovado pela metade que
          // sobrou. Com 5 braços × N docs × 3 repetições em sequência, falha de
          // quota é o caso esperado, não a exceção.
          falhas[braco.chave] = (falhas[braco.chave] ?? 0) + 1;
          resultados[braco.chave].push({
            campos: compararCampos(caso.esperado, null),
            categoriaCorreta: false,
            jsonAproveitavel: false,
            latenciaMs: Date.now() - t0,
            custoUsd: 0,
          });
          console.error(
            `  ${braco.chave} ${caso.arquivo} r${r + 1}: ${err instanceof Error ? err.message.slice(0, 90) : err}`
          );
          continue;
        }

        const latenciaMs = Date.now() - t0;
        const parsed = parseTolerante(texto);
        const tok = geminiUsageToTokens(usage, braco.modelo);
        const custoUsd = calcCostUsd(braco.modelo, tok.promptTokens, tok.completionTokens);
        const campos = (parsed?.campos ?? null) as Record<string, unknown> | null;

        resultados[braco.chave].push({
          campos: compararCampos(caso.esperado, campos),
          // Comparado contra `categoriaEsperada`, que é ANOTAÇÃO HUMANA. Usar a
          // `category` do banco julgaria o baseline contra a própria saída dele
          // — o incumbente acertaria por definição e os candidatos seriam
          // punidos por rótulo igualmente correto. Sem anotação, a métrica é
          // omitida em vez de inventada.
          categoriaCorreta:
            caso.categoriaEsperada
              ? normalizarCategoria(parsed?.tipo) === caso.categoriaEsperada
              : false,
          jsonAproveitavel: parsed !== null,
          latenciaMs,
          custoUsd,
        });
      }
      process.stdout.write(".");
    }
    process.stdout.write(`  ${braco.chave}\n`);
  }

  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  console.log("\n=== RESULTADO ===\n");
  console.log(
    "braço".padEnd(28) + "acur.pond".padStart(10) + "alucin.".padStart(9) +
      "omiss.".padStart(9) + "categ.".padStart(8) + "JSON ok".padStart(9) +
      "p50".padStart(8) + "p95".padStart(8) + "US$/doc".padStart(11) +
      "falhas".padStart(9)
  );

  const agregados: Record<string, ReturnType<typeof agregar>> = {};
  for (const braco of bracos) {
    const a = agregar(resultados[braco.chave]);
    agregados[braco.chave] = a;
    console.log(
      braco.rotulo.padEnd(28) +
        pct(a.acuraciaPonderada).padStart(10) +
        pct(a.taxaAlucinacao).padStart(9) +
        pct(a.taxaOmissao).padStart(9) +
        pct(a.acertoCategoria).padStart(8) +
        pct(a.jsonAproveitavel).padStart(9) +
        `${Math.round(a.latenciaP50)}ms`.padStart(8) +
        `${Math.round(a.latenciaP95)}ms`.padStart(8) +
        `$${a.custoPorDocUsd.toFixed(5)}`.padStart(11) +
        `${falhas[braco.chave] ?? 0}`.padStart(9)
    );
  }

  const totalFalhas = Object.values(falhas).reduce((s, n) => s + n, 0);
  if (totalFalhas > 0) {
    console.log(
      `\n⚠ ${totalFalhas} chamada(s) falharam e contam como omissão total.\n` +
        `  Falha concentrada num braço derruba a acurácia DELE — confira se é o\n` +
        `  modelo ou se foi rate limit antes de concluir qualquer coisa.`
    );
  }

  const base = agregados["baseline"];
  if (base) {
    console.log("\n=== VEREDITO vs produção de hoje ===\n");
    for (const braco of bracos) {
      if (braco.chave === "baseline") continue;
      const v = avaliar(base, agregados[braco.chave]);
      console.log(`${braco.rotulo.padEnd(28)} ${v.aprovado ? "APROVADO" : "REPROVADO"}`);
      for (const m of v.motivos) console.log(`    · ${m}`);
    }
    console.log(
      "\nAlucinação é VETO: acurácia melhor não compensa alucinar mais. Campo\n" +
        "vazio o corretor percebe; campo errado ele assina."
    );
  }

  // Sem stamp, execuções consecutivas sobrescreviam o mesmo arquivo — e
  // comparar duas rodadas é justamente o uso.
  const stamp = process.env.BENCH_STAMP ?? String(Date.now());
  const saida = path.join(FIXTURES, `resultado-${stamp}.json`);
  fs.writeFileSync(saida, JSON.stringify({ agregados }, null, 2));
  console.log(`\nAgregados em ${saida} (pasta ignorada pelo git).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
