/**
 * Monta o corpus do bench de VISÃO a partir de anexos REAIS já processados.
 *
 * ── Por que existe ────────────────────────────────────────────────────────
 *
 * O bench de hoje roda 2 fixtures SINTÉTICAS em TEXTO PURO. Ele não manda
 * imagem nem PDF para modelo nenhum, ou seja, não exercita OCR — mede extração
 * sobre texto que já estava legível. Medido em 24/08 num PDF sintético bem
 * diagramado, os quatro modelos candidatos acertaram 16/16: sintético limpo não
 * separa modelo nenhum. Quem separa é escaneado torto, carimbado, amarelado,
 * fotografado de celular com sombra — que é o que chega no formulário.
 *
 * ── O gabarito NÃO é o extractedData ─────────────────────────────────────
 *
 * `FormAttachment.extractedData` é saída do `gemini-2.5-flash`, o modelo em
 * produção. Usá-lo como gabarito faria o bench PREMIAR quem concorda com o
 * modelo atual e punir quem o corrige — o número diria "ninguém supera o
 * incumbente" por construção, mesmo que alguém supere.
 *
 * Então este script escreve o `extractedData` como RASCUNHO, num campo
 * `_rascunhoDoModeloAtual`, e o gabarito de verdade (`esperado`) nasce VAZIO.
 * Alguém precisa abrir o documento e preencher campo a campo. É trabalho
 * manual e é o ponto: sem isso o bench mede concordância, não acurácia.
 *
 * ── Travas ───────────────────────────────────────────────────────────────
 *
 * 1. Escreve só em `fixtures/vision/`, que está no .gitignore desde o commit
 *    anterior a este. Os documentos são de pessoas reais e o repo é público.
 * 2. Exige `--org=<id>` explícito. Sem escopo, um `findMany` varre TODAS as
 *    orgs do banco — inclusive tenants de clientes.
 * 3. Exige `--confirmo-o-banco=<trecho>` e COMPARA o trecho com o
 *    `DATABASE_URL` real, abortando se não bater. Só checar que a flag existe
 *    seria teatro — `--confirmo-o-banco=staging` apontado para produção
 *    passaria sem reclamar, e uma trava que não trava é pior que nenhuma.
 * 4. Nunca sobrescreve o `ground-truth.json`: mescla por `id` e PRESERVA
 *    `esperado` já anotado. A anotação manual é o que faz o bench medir
 *    acurácia, e são horas de trabalho.
 *
 * ── Uso ──────────────────────────────────────────────────────────────────
 *
 *   cd apps/web
 *   DATABASE_URL=... npx tsx scripts/ai-bench/pull-fixtures.ts \
 *     --org=<orgId> --confirmo-o-banco=staging [--limite=40]
 */
import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";

const OUT_DIR = path.join(__dirname, "fixtures", "vision");
const DOCS_DIR = path.join(OUT_DIR, "docs");
const GABARITO = path.join(OUT_DIR, "ground-truth.json");

/**
 * Categorias que valem no corpus, e quantas de cada. Estratificado de
 * propósito: um corpus com 30 RGs e 1 matrícula mede leitura de RG, não OCR.
 */
const COTA_POR_CATEGORIA: Record<string, number> = {
  matricula: 8,
  rg: 6,
  cnh: 6,
  iptu: 4,
  comprovante_residencia: 4,
  certidao_casamento: 3,
  escritura: 3,
  procuracao: 3,
  cpf: 2,
  ficha_resumo: 2,
  outro: 2,
};

interface CasoVisao {
  id: string;
  arquivo: string;
  mime: string;
  /** Categoria que o modelo ATUAL atribuiu. Também é palpite, não gabarito. */
  categoriaSugerida: string | null;
  /**
   * Categoria conferida À MÃO. Separada de `categoriaSugerida` de propósito:
   * aquela é a saída do modelo atual, e usá-la para julgar faria o incumbente
   * acertar por definição.
   */
  categoriaEsperada?: string | null;
  /** Vazio de propósito — preencher à mão contra o documento. Ver cabeçalho. */
  esperado: Record<string, unknown>;
  /** Saída do gemini-2.5-flash. Ponto de partida da conferência, não verdade. */
  _rascunhoDoModeloAtual: Record<string, unknown>;
  /** `true` = o OCR de produção falhou neste doc. São os casos mais valiosos. */
  falhouEmProducao: boolean;
}

function arg(nome: string): string | null {
  const p = process.argv.find((a) => a.startsWith(`--${nome}=`));
  return p ? p.slice(nome.length + 3) : null;
}

async function main() {
  const orgId = arg("org");
  const confirmacao = arg("confirmo-o-banco");
  const limiteBruto = arg("limite");
  const limite = limiteBruto === null ? 40 : Number(limiteBruto);
  if (!Number.isInteger(limite) || limite <= 0) {
    console.error(`--limite precisa ser inteiro positivo (recebi ${JSON.stringify(limiteBruto)}).`);
    process.exit(1);
  }

  if (!orgId) {
    console.error(
      "Faltou --org=<orgId>.\n" +
        "Sem escopo, a consulta varreria TODAS as orgs do banco, inclusive\n" +
        "tenants de clientes. O corpus tem que sair de dados que você tem\n" +
        "direito de usar."
    );
    process.exit(1);
  }
  if (!confirmacao) {
    console.error(
      "Faltou --confirmo-o-banco=<trecho-do-host>.\n" +
        "Este script LÊ DOCUMENTOS para o disco local. Rodar contra produção\n" +
        "significa copiar documento de cliente para uma máquina de\n" +
        "desenvolvimento. Confirme explicitamente contra qual banco está\n" +
        "rodando antes de continuar."
    );
    process.exit(1);
  }

  // A confirmação é COMPARADA com o `DATABASE_URL` real. Só exigir que a flag
  // exista era teatro: `--confirmo-o-banco=staging` apontado para produção
  // passava sem reclamar, e uma trava que não trava é pior que nenhuma —
  // ela produz confiança.
  const dbUrl = process.env.DATABASE_URL ?? "";
  if (!dbUrl) {
    console.error("DATABASE_URL ausente.");
    process.exit(1);
  }
  if (!dbUrl.toLowerCase().includes(confirmacao.toLowerCase())) {
    let host = "(não parseável)";
    try {
      host = new URL(dbUrl).host;
    } catch {
      /* URL malformada: o importante é NÃO imprimir a senha que ela contém. */
    }
    console.error(
      `A confirmação não bate com o banco.\n` +
        `  --confirmo-o-banco=${confirmacao}\n` +
        `  host real: ${host}\n\n` +
        `Passe um trecho que apareça no DATABASE_URL de verdade. Se o host que\n` +
        `você está vendo acima não é o que esperava, PARE: este script baixaria\n` +
        `documentos de pessoas reais desse banco para o disco local.`
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();
  fs.mkdirSync(DOCS_DIR, { recursive: true });

  // `failed` entra junto: são exatamente os documentos onde o modelo atual
  // erra, e um corpus só com o que já deu certo mede o caso fácil.
  const anexos = await prisma.formAttachment.findMany({
    where: {
      status: { in: ["ready", "failed"] },
      form: { orgId },
    },
    select: {
      id: true,
      filename: true,
      mime: true,
      url: true,
      category: true,
      status: true,
      extractedData: true,
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  console.log(`${anexos.length} anexo(s) candidatos na org ${orgId}.`);

  const usados: Record<string, number> = {};
  const casos: CasoVisao[] = [];

  for (const a of anexos) {
    if (casos.length >= limite) break;
    const cat = a.category ?? "outro";
    const cota = COTA_POR_CATEGORIA[cat];
    if (cota === undefined) continue;
    if ((usados[cat] ?? 0) >= cota) continue;

    let bytes: Buffer;
    try {
      const res = await fetch(a.url);
      if (!res.ok) {
        console.warn(`  skip ${a.id}: HTTP ${res.status} ao baixar`);
        continue;
      }
      bytes = Buffer.from(await res.arrayBuffer());
    } catch (err) {
      console.warn(`  skip ${a.id}: ${err instanceof Error ? err.message : err}`);
      continue;
    }

    // Nome de arquivo derivado do ID, NÃO do `filename` original: nomes de
    // upload costumam trazer o nome da pessoa ("rg-joao-da-silva.pdf") e viram
    // PII em `ls`, em log de terminal e em qualquer print de tela.
    // Extensão sanitizada: `a.mime` vem do banco e vai para um caminho de
    // escrita — barra ou ".." ali sairiam do diretório ignorado pelo git.
    const subtipo = (a.mime.split("/")[1] ?? "").replace(/[^a-z0-9]/gi, "").slice(0, 8);
    const ext = a.mime === "application/pdf" ? "pdf" : subtipo || "bin";
    const arquivo = `${cat}-${a.id}.${ext}`;
    fs.writeFileSync(path.join(DOCS_DIR, arquivo), bytes);

    const extracted = (a.extractedData ?? {}) as Record<string, unknown>;
    casos.push({
      id: a.id,
      arquivo,
      mime: a.mime,
      categoriaSugerida: a.category,
      categoriaEsperada: null,
      esperado: {},
      _rascunhoDoModeloAtual: (extracted.fields ?? {}) as Record<string, unknown>,
      falhouEmProducao: a.status === "failed",
    });
    usados[cat] = (usados[cat] ?? 0) + 1;
  }

  // MESCLA com o que já existe, por `id`. Sobrescrever destruiria horas de
  // anotação manual — e o gabarito anotado é a única coisa que faz este bench
  // medir acurácia em vez de concordância com o modelo atual. Reexecutar o
  // puller (para subir o --limite, incluir outra categoria, refazer um download
  // que falhou) é rotina; perder o gabarito não pode ser o preço disso.
  let preservados = 0;
  if (fs.existsSync(GABARITO)) {
    const anterior = JSON.parse(fs.readFileSync(GABARITO, "utf8")) as {
      casos?: CasoVisao[];
    };
    const porId = new Map((anterior.casos ?? []).map((c) => [c.id, c]));
    for (const novo of casos) {
      const velho = porId.get(novo.id);
      if (velho && Object.keys(velho.esperado ?? {}).length > 0) {
        novo.esperado = velho.esperado;
        novo.categoriaEsperada = velho.categoriaEsperada;
        preservados += 1;
      }
      porId.set(novo.id, novo);
    }
    // Casos que sumiram da consulta (fora da cota, ou anexo removido) continuam
    // no arquivo: se alguém anotou, o trabalho fica.
    casos.length = 0;
    casos.push(...porId.values());
  }

  fs.writeFileSync(GABARITO, JSON.stringify({ casos }, null, 2));
  await prisma.$disconnect();

  const falhados = casos.filter((c) => c.falhouEmProducao).length;
  console.log(`\n${casos.length} caso(s) escritos em ${OUT_DIR}`);
  console.log(`  por categoria: ${JSON.stringify(usados)}`);
  console.log(`  que falharam em produção: ${falhados}`);
  console.log(
    `\nPRÓXIMO PASSO, e o bench não vale nada sem ele: abra cada documento em\n` +
      `${DOCS_DIR} e preencha \`esperado\` no ground-truth.json conferindo campo\n` +
      `a campo. O \`_rascunhoDoModeloAtual\` é ponto de partida, NÃO gabarito —\n` +
      `ele é a saída do modelo que está sendo julgado.`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
