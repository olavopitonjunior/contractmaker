/**
 * Consolidação de modelos repetidos — o coração da central de ingestão.
 *
 * O usuário real não tem "1 modelo + variantes organizadas": tem VÁRIOS arquivos
 * quase idênticos que só mudam uma ou duas cláusulas (locação com fiador, com
 * caução, com seguro-fiança…). Este módulo AGRUPA esses arquivos, extrai a BASE
 * COMUM e isola os BLOCOS DIVERGENTES de cada variante — para que a base vire um
 * único template com slot de cláusula e os blocos virem cláusulas do acervo
 * amarradas à opção do formulário.
 *
 * INVARIANTE: **zero IA na comparação**. Tudo aqui é determinístico (parágrafos
 * normalizados + LCS), testável e sem custo. A IA entra no máximo sugerindo o
 * RÓTULO de uma variante — e mesmo isso tem um palpite determinístico por
 * palavra-chave aqui (`suggestGarantiaTipo`), usado como default do <select>.
 *
 * Módulo PURO e CLIENT-SAFE: sem prisma, sem fs, sem rede. A tela de triagem
 * importa direto e agrupa no browser, com os textos que a rota de análise já
 * devolveu — sem uma segunda viagem ao servidor só pra comparar strings.
 */

import { GARANTIA_TIPOS, type GarantiaTipo } from "@/lib/contracts/template-category";

// ────────────────────────────────────────────────────────────────────────────
// Normalização
// ────────────────────────────────────────────────────────────────────────────

/** Parágrafo curto demais é cabeçalho solto/ruído de extração, não conteúdo. */
const MIN_PARAGRAPH_CHARS = 12;

/**
 * Chave de comparação de um parágrafo: minúsculas, sem acento, sem pontuação e
 * com espaços colapsados. Dois modelos da mesma família costumam divergir em
 * espaço duplo, travessão e caixa — normalizar isso é o que faz a base comum
 * emergir em vez de tudo virar divergência.
 *
 * NÚMEROS são preservados: "8.1." vs "9.1." é uma diferença real de numeração e
 * a renumeração é justamente um efeito colateral que o operador precisa ver.
 */
export function paragraphKey(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Quebra o texto extraído em parágrafos. Aceita tanto texto com linhas em branco
 * (DOCX via mammoth) quanto uma linha por parágrafo (Docs API): a quebra é por
 * linha e parágrafos vazios/curtos somem.
 */
export function toParagraphs(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= MIN_PARAGRAPH_CHARS);
}

export interface ConsolidationDoc {
  /** Identidade estável do arquivo na fila da triagem (nome + índice serve). */
  id: string;
  name: string;
  /** Texto já extraído do DOCX/PDF. */
  text: string;
  /**
   * Só documentos da MESMA família podem agrupar. Normalmente a modalidade
   * confirmada pelo usuário; ausente = agrupa com qualquer outro sem família.
   */
  family?: string | null;
}

/**
 * Piso de tamanho da VISÃO DE COMPARAÇÃO (só o agrupamento; o plano usa tudo).
 *
 * Medido no corpus real da Ativa (4 contratos residenciais preenchidos, fixture
 * em `__tests__/fixtures/ativa-residencial/`): ~20 a 25 dos ~60 parágrafos de
 * cada arquivo são o BLOCO DE ASSINATURAS e as linhas soltas de qualificação —
 * "CPF 111.222.333-96", "RG 12.345.678-9 SSP/SP", o nome de cada signatário numa
 * linha. Isso é DADO DE INSTÂNCIA: muda a cada contrato (4 signatários num
 * arquivo, 5 no outro; "CPF 111…" num, "CPF sob nº. 111…" no outro) e não diz
 * nada sobre os arquivos serem ou não o mesmo modelo — mas, contado como
 * parágrafo, afundava a similaridade justamente do arquivo mais diferente.
 *
 * Com o piso em 40 caracteres, a pior similaridade par-a-par do corpus sobe de
 * 0.574 pra 0.709 e o *spread* fecha (o outlier deixa de existir). Cláusulas
 * reais têm centenas de caracteres; nada de conteúdo é perdido.
 */
export const COMPARISON_MIN_CHARS = 40;

export interface NormalizedDoc {
  id: string;
  name: string;
  family: string | null;
  /** Parágrafos íntegros — é o que o PLANO usa (o texto vai pro replaceAllText). */
  paragraphs: string[];
  /** Chaves de todos os parágrafos, na ordem de `paragraphs`. */
  keys: string[];
  /**
   * Chaves da VISÃO DE COMPARAÇÃO: só os parágrafos de conteúdo. É o que
   * `similarity`/`containment`/`groupSimilarDocs` usam — ver COMPARISON_MIN_CHARS.
   */
  compareKeys: string[];
}

export function normalizeDoc(doc: ConsolidationDoc): NormalizedDoc {
  const paragraphs = toParagraphs(doc.text);
  return {
    id: doc.id,
    name: doc.name,
    family: doc.family ?? null,
    paragraphs,
    keys: paragraphs.map(paragraphKey),
    compareKeys: paragraphs
      .filter((p) => p.length >= COMPARISON_MIN_CHARS)
      .map(paragraphKey),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// LCS (Longest Common Subsequence) sobre parágrafos
// ────────────────────────────────────────────────────────────────────────────

/**
 * Guarda de custo: LCS é O(n·m). Contratos reais têm ~60-250 parágrafos; acima
 * disso truncamos (o excedente entra como divergência, o que é conservador —
 * nunca inventa base comum que não existe).
 */
const MAX_PARAGRAPHS = 600;

/** LCS de duas sequências de chaves. Devolve a subsequência comum (as chaves). */
export function lcsKeys(a: readonly string[], b: readonly string[]): string[] {
  const A = a.length > MAX_PARAGRAPHS ? a.slice(0, MAX_PARAGRAPHS) : a;
  const B = b.length > MAX_PARAGRAPHS ? b.slice(0, MAX_PARAGRAPHS) : b;
  const n = A.length;
  const m = B.length;
  if (n === 0 || m === 0) return [];

  // Matriz de tamanhos em Int32Array — (n+1)*(m+1) inteiros, ~1.4MB no pior
  // caso permitido. Suficientemente barato e evita alocar N arrays.
  const dp = new Int32Array((n + 1) * (m + 1));
  const at = (i: number, j: number) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[at(i, j)] =
        A[i] === B[j]
          ? dp[at(i + 1, j + 1)] + 1
          : Math.max(dp[at(i + 1, j)], dp[at(i, j + 1)]);
    }
  }

  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      out.push(A[i]);
      i++;
      j++;
    } else if (dp[at(i + 1, j)] >= dp[at(i, j + 1)]) {
      i++;
    } else {
      j++;
    }
  }
  return out;
}

/**
 * Similaridade estrutural (coeficiente de Dice): 2·|LCS| / (|A|+|B|) — 1 =
 * idênticos em parágrafos, 0 = nada em comum. Simétrica e severa com qualquer
 * diferença de tamanho.
 */
export function similarity(a: NormalizedDoc, b: NormalizedDoc): number {
  const total = a.compareKeys.length + b.compareKeys.length;
  if (total === 0) return 0;
  return (2 * lcsKeys(a.compareKeys, b.compareKeys).length) / total;
}

/**
 * Contenção: |LCS| / min(|A|,|B|) — "o quanto do documento MENOR está dentro do
 * maior". É a métrica certa pro caso "tronco comum + bloco opcional grande":
 * o contrato com o rider da seguradora (6 cláusulas a mais) contém o tronco
 * inteiro dos outros, mas o Dice o penaliza pela adição e ele fica de fora do
 * grupo — que é exatamente o modelo que o operador MAIS precisa consolidar.
 */
export function containment(a: NormalizedDoc, b: NormalizedDoc): number {
  const smaller = Math.min(a.compareKeys.length, b.compareKeys.length);
  if (smaller === 0) return 0;
  return lcsKeys(a.compareKeys, b.compareKeys).length / smaller;
}

// ────────────────────────────────────────────────────────────────────────────
// Agrupamento
// ────────────────────────────────────────────────────────────────────────────

/**
 * Alta similaridade = "é o mesmo contrato variando uma cláusula". Calibrado
 * alto de propósito: um falso agrupamento pede ao usuário que rotule variantes
 * de documentos diferentes (confuso); um falso NÃO-agrupamento só devolve o
 * caminho simples (um template por arquivo), que é o comportamento de hoje.
 */
export const DEFAULT_SIMILARITY_THRESHOLD = 0.75;

/**
 * Contenção mínima pro critério alternativo. Mais alto que o de Dice porque
 * contenção é uma métrica mais frouxa por natureza — ela ignora tudo que o
 * documento maior tem a mais.
 */
export const DEFAULT_CONTAINMENT_THRESHOLD = 0.85;

/**
 * Guarda de tamanho relativo do critério de contenção: o menor documento tem de
 * ter ao menos metade dos parágrafos do maior.
 *
 * Sem ela a contenção degenera — um anexo de 5 parágrafos está 100% contido num
 * contrato de 60 e viraria "variante" dele. Com ela, "contido" só vale entre
 * documentos comparáveis, que é o caso do tronco + rider (no corpus da Ativa a
 * razão do par mais desigual é 0.85).
 */
export const MIN_SIZE_RATIO = 0.5;

/** Qual critério sustentou o grupo (ver `groupSimilarDocs`). */
export type GroupCriterion = "dice" | "containment";

export interface ConsolidationGroup {
  /** Estável: id do 1º membro na ordem de entrada. */
  id: string;
  memberIds: string[];
  /** Menor Dice par-a-par dentro do grupo (o elo mais fraco) — é o "% idêntico". */
  minSimilarity: number;
  /** Menor contenção par-a-par dentro do grupo. */
  minContainment: number;
  /**
   * `"dice"` quando TODAS as ligações do grupo passaram pela similaridade
   * clássica; `"containment"` quando ao menos uma só existe porque um documento
   * está contido no outro (o caso "tronco + rider"). Serve de diagnóstico: um
   * grupo formado só por contenção é o que mais merece o olho do operador.
   */
  linkedBy: GroupCriterion;
}

/**
 * Agrupa documentos quase idênticos. Clustering guloso por ligação simples
 * (union-find), com CRITÉRIO DUPLO por par:
 *
 *   Dice ≥ 0.75            — "são quase o mesmo texto"; ou
 *   contenção ≥ 0.85       — "o menor está quase inteiro dentro do maior",
 *                            desde que os tamanhos sejam comparáveis
 *                            (`MIN_SIZE_RATIO`).
 *
 * O segundo critério existe por um caso REAL do corpus da Ativa: o contrato com
 * o rider da seguradora traz 6 cláusulas a mais que os irmãos, e o Dice — que
 * pune adição — o deixava de fora do próprio grupo. Justo o modelo que mais
 * precisa ser consolidado.
 *
 * O grupo cresce por transitividade: três variantes de garantia costumam formar
 * um triângulo completo, mas basta a corrente pra ficarem juntas.
 *
 * Documentos de FAMÍLIAS diferentes nunca agrupam (uma proposta de locação e um
 * contrato de locação compartilham preâmbulo, mas não são a mesma coisa) — é
 * essa guarda que impede a contenção de casar documentos de naturezas distintas.
 *
 * Grupos de 1 membro são omitidos: eles seguem o caminho simples.
 */
export function groupSimilarDocs(
  docs: NormalizedDoc[],
  opts?: { threshold?: number; containmentThreshold?: number }
): ConsolidationGroup[] {
  const threshold = opts?.threshold ?? DEFAULT_SIMILARITY_THRESHOLD;
  const containmentThreshold =
    opts?.containmentThreshold ?? DEFAULT_CONTAINMENT_THRESHOLD;
  const parent = docs.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };

  interface PairScore {
    dice: number;
    containment: number;
    linked: GroupCriterion | null;
  }
  const pairs = new Map<string, PairScore>();

  for (let i = 0; i < docs.length; i++) {
    for (let j = i + 1; j < docs.length; j++) {
      if ((docs[i].family ?? null) !== (docs[j].family ?? null)) continue;

      const a = docs[i].compareKeys;
      const b = docs[j].compareKeys;
      const lcs = lcsKeys(a, b).length;
      const total = a.length + b.length;
      const smaller = Math.min(a.length, b.length);
      const larger = Math.max(a.length, b.length);

      const dice = total === 0 ? 0 : (2 * lcs) / total;
      const cont = smaller === 0 ? 0 : lcs / smaller;
      const sizeOk = larger > 0 && smaller / larger >= MIN_SIZE_RATIO;

      const linked: GroupCriterion | null =
        dice >= threshold
          ? "dice"
          : sizeOk && cont >= containmentThreshold
            ? "containment"
            : null;

      pairs.set(`${i}:${j}`, { dice, containment: cont, linked });
      if (linked) union(i, j);
    }
  }

  const byRoot = new Map<number, number[]>();
  for (let i = 0; i < docs.length; i++) {
    const root = find(i);
    const list = byRoot.get(root);
    if (list) list.push(i);
    else byRoot.set(root, [i]);
  }

  const groups: ConsolidationGroup[] = [];
  for (const members of byRoot.values()) {
    if (members.length < 2) continue;
    let minDice = 1;
    let minCont = 1;
    let linkedBy: GroupCriterion = "dice";
    for (let a = 0; a < members.length; a++) {
      for (let b = a + 1; b < members.length; b++) {
        const [i, j] = [members[a], members[b]].sort((x, y) => x - y);
        const score = pairs.get(`${i}:${j}`);
        minDice = Math.min(minDice, score?.dice ?? 0);
        minCont = Math.min(minCont, score?.containment ?? 0);
        // Basta UMA ligação que só existiu por contenção pra o grupo ser
        // marcado assim — é o sinal de "tem um irmão com bloco a mais aqui".
        if (score?.linked === "containment") linkedBy = "containment";
      }
    }
    groups.push({
      id: docs[members[0]].id,
      memberIds: members.map((i) => docs[i].id),
      minSimilarity: Number(minDice.toFixed(4)),
      minContainment: Number(minCont.toFixed(4)),
      linkedBy,
    });
  }
  // Ordem de entrada do 1º membro — a UI mostra os grupos na ordem da fila.
  return groups.sort(
    (a, b) =>
      docs.findIndex((d) => d.id === a.id) - docs.findIndex((d) => d.id === b.id)
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Base comum × blocos divergentes
// ────────────────────────────────────────────────────────────────────────────

/** Bloco contíguo de parágrafos que existe só numa variante. */
export interface VariantBlock {
  /**
   * Quantos parágrafos da BASE COMUM já apareceram antes deste bloco. É a
   * âncora que diz onde o slot entra no documento (0 = antes de tudo).
   */
  anchorIndex: number;
  paragraphs: string[];
}

export interface ConsolidationVariant {
  docId: string;
  name: string;
  blocks: VariantBlock[];
  /** Nº de parágrafos exclusivos — o "tamanho" da divergência. */
  divergentCount: number;
}

export interface ConsolidationPlan {
  /**
   * Parágrafos presentes em TODOS os documentos, na ordem, com o texto do
   * documento de referência (o 1º da lista). É a base do template consolidado.
   */
  commonParagraphs: string[];
  variants: ConsolidationVariant[];
  /** Documento cujo texto original serve de base (o 1º recebido). */
  referenceDocId: string;
}

/**
 * Extrai a base comum a N documentos e os blocos divergentes de cada um.
 *
 * A base comum é o LCS acumulado (`LCS(LCS(d1,d2),d3)…`). Como o resultado é
 * subsequência de TODOS os documentos por construção, o alinhamento de cada
 * documento contra ela é um simples two-pointer — sem uma segunda matriz.
 *
 * Lança com 0 documentos; com 1 documento devolve tudo como base comum e nenhuma
 * divergência (o caminho simples).
 */
export function buildConsolidationPlan(docs: NormalizedDoc[]): ConsolidationPlan {
  if (docs.length === 0) {
    throw new Error("buildConsolidationPlan: lista de documentos vazia");
  }

  let commonKeys = docs[0].keys.slice(0, MAX_PARAGRAPHS);
  for (let i = 1; i < docs.length; i++) {
    commonKeys = lcsKeys(commonKeys, docs[i].keys);
    if (commonKeys.length === 0) break;
  }

  // Texto da base = o do documento de referência, alinhado contra as chaves.
  const commonParagraphs: string[] = [];
  {
    const ref = docs[0];
    let c = 0;
    for (let p = 0; p < ref.keys.length && c < commonKeys.length; p++) {
      if (ref.keys[p] === commonKeys[c]) {
        commonParagraphs.push(ref.paragraphs[p]);
        c++;
      }
    }
  }

  const variants: ConsolidationVariant[] = docs.map((doc) => {
    const blocks: VariantBlock[] = [];
    let anchor = 0;
    let pending: string[] = [];
    const flush = () => {
      if (pending.length) {
        blocks.push({ anchorIndex: anchor, paragraphs: pending });
        pending = [];
      }
    };
    for (let p = 0; p < doc.keys.length; p++) {
      if (anchor < commonKeys.length && doc.keys[p] === commonKeys[anchor]) {
        flush();
        anchor++;
      } else {
        pending.push(doc.paragraphs[p]);
      }
    }
    flush();
    return {
      docId: doc.id,
      name: doc.name,
      blocks,
      divergentCount: blocks.reduce((n, b) => n + b.paragraphs.length, 0),
    };
  });

  return { commonParagraphs, variants, referenceDocId: docs[0].id };
}

/**
 * Matriz de diferenças pra UI: uma linha por bloco divergente, com o texto de
 * cada variante lado a lado. Blocos com a MESMA âncora são a mesma "posição do
 * documento" — é assim que "cláusula 8 de cada variante" aparece na mesma linha.
 */
export interface DifferenceRow {
  anchorIndex: number;
  /** docId → parágrafos daquela variante nessa posição ([] = variante não tem). */
  byDoc: Record<string, string[]>;
}

export function buildDifferenceMatrix(plan: ConsolidationPlan): DifferenceRow[] {
  const anchors = new Set<number>();
  for (const v of plan.variants) for (const b of v.blocks) anchors.add(b.anchorIndex);

  return Array.from(anchors)
    .sort((a, b) => a - b)
    .map((anchorIndex) => {
      const byDoc: Record<string, string[]> = {};
      for (const v of plan.variants) {
        byDoc[v.docId] = v.blocks
          .filter((b) => b.anchorIndex === anchorIndex)
          .flatMap((b) => b.paragraphs);
      }
      return { anchorIndex, byDoc };
    });
}

/**
 * A posição do documento onde a divergência é MAIOR — é essa que vira o slot.
 *
 * Um lote real costuma divergir em mais de um lugar (a cláusula de garantia E a
 * qualificação do fiador no preâmbulo, por exemplo). O slot cobre UMA posição:
 * abrir vários tokens espalhados transformaria o modelo num quebra-cabeça e a
 * cláusula do acervo deixaria de ser autossuficiente. Escolhemos a maior (a
 * cláusula de fato) e a UI mostra as demais como "outras diferenças", que ficam
 * no texto do modelo de referência — visíveis e editáveis na revisão.
 */
export function primaryDifferenceRow(rows: DifferenceRow[]): DifferenceRow | null {
  let best: DifferenceRow | null = null;
  let bestSize = 0;
  for (const row of rows) {
    const size = Object.values(row.byDoc).reduce(
      (n, ps) => n + ps.reduce((m, p) => m + p.length, 0),
      0
    );
    if (size > bestSize) {
      best = row;
      bestSize = size;
    }
  }
  return best;
}

// ────────────────────────────────────────────────────────────────────────────
// Palpite de rótulo da variante (determinístico)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Palavras que identificam cada tipo de garantia do formulário. Ordem importa:
 * "título de capitalização" e "seguro fiança" citam "fiança"/"caução" no texto,
 * então os específicos são testados primeiro.
 */
const GARANTIA_HINTS: Array<{ tipo: GarantiaTipo; patterns: RegExp[] }> = [
  {
    tipo: "titulo_capitalizacao",
    patterns: [/titulo de capitalizacao/, /sociedade de capitalizacao/],
  },
  {
    tipo: "seguro_fianca",
    patterns: [/seguro (de )?fianca/, /apolice/, /seguradora/],
  },
  {
    tipo: "garantia_digital",
    patterns: [/garantia (locaticia )?digital/, /termo de adesao/],
  },
  { tipo: "fiador", patterns: [/fiador/, /beneficio de ordem/, /fianca/] },
  { tipo: "caucao", patterns: [/caucao/, /art(igo)? 38/] },
  { tipo: "propria", patterns: [/garantia propria/] },
  {
    tipo: "sem_garantia",
    patterns: [/sem (modalidade de )?garantia/, /dispensa(m|da)? (de )?garantia/],
  },
];

/**
 * Palpite do tipo de garantia a partir do texto de um bloco divergente. É só um
 * DEFAULT do <select>: quem confirma é o usuário, com as mesmas opções do
 * formulário. Devolve null quando nenhuma palavra-chave aparece.
 */
export function suggestGarantiaTipo(text: string): GarantiaTipo | null {
  const key = paragraphKey(text);
  for (const { tipo, patterns } of GARANTIA_HINTS) {
    if (patterns.some((re) => re.test(key))) return tipo;
  }
  return null;
}

/** Guard usado pelas rotas ao validar o valor escolhido na triagem. */
export function isGarantiaTipo(v: unknown): v is GarantiaTipo {
  return typeof v === "string" && (GARANTIA_TIPOS as readonly string[]).includes(v);
}
