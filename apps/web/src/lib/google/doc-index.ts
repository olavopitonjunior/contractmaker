/**
 * Ponte entre o texto PLANO de um Google Doc e os índices absolutos da Docs API.
 *
 * Toda edição estrutural (`deleteContentRange`, `insertText`) fala em índices
 * absolutos do documento, não em texto. Quem tem o texto — as travas de
 * unicidade, as checagens semânticas, o operador que selecionou um trecho —
 * precisa traduzir "este parágrafo" para "do índice X ao Y".
 *
 * Estas funções viviam privadas em `lib/google/loops.ts`, que as usa para achar
 * `[[REPEAT]]`. Saíram para cá quando ganharam um segundo caso: restaurar um
 * parágrafo que uma chave engoliu, que é estrutural por necessidade —
 * `replaceAllText` NÃO cria parágrafo (o `\n` no texto de troca não é
 * documentado como quebra), então devolver várias linhas exige apagar o
 * intervalo e inserir texto novo.
 */
import type { docs_v1 } from "googleapis";

/**
 * Espaço não-quebrável ≠ espaço — e o export `text/plain` do Drive NORMALIZA:
 * onde o Doc tem NBSP (código 160), o texto que o app lê tem espaço (32). O
 * DOCX da imobiliária traz NBSP depois de "8.1." e dentro de moedas; um
 * `replaceAllText` com a forma lida casa ZERO no Docs. Medido em staging
 * (04/09/2026): a cláusula de garantia por caução saía `replace-noop`.
 *
 * Toda comparação entre texto lido e texto do Doc passa por aqui, e o que vai
 * para a API é a forma REAL (ver {@link findForms}).
 */
// INVARIANTE: cada caractere normaliza para EXATAMENTE um caractere. `findForms`
// fatia o texto ORIGINAL com índices calculados no texto normalizado; um
// mapeamento de largura diferente (ligadura, sequência composta) deslocaria a
// fatia e o `replaceAllText` receberia o trecho errado — falhando ao ESCREVER,
// não ao recusar. Só entra aqui o que é 1:1.
const NBSP_RE = /[\u00A0\u202F]/g;
export function normalizeSpaces(text: string): string {
  return text.replace(NBSP_RE, " ");
}

/**
 * Ocorrências de `needle` em `hay` tolerando NBSP≠espaço, com a forma REAL de
 * cada uma (a fatia de `hay`). A normalização preserva o comprimento, então os
 * índices do texto normalizado valem no original.
 */
export function findForms(hay: string, needle: string): { count: number; forms: string[] } {
  if (!needle) return { count: 0, forms: [] };
  const nh = normalizeSpaces(hay);
  const nn = normalizeSpaces(needle);
  const forms: string[] = [];
  let idx = nh.indexOf(nn);
  while (idx !== -1) {
    forms.push(hay.slice(idx, idx + nn.length));
    idx = nh.indexOf(nn, idx + 1);
  }
  return { count: forms.length, forms };
}

/**
 * Comparação de PARÁGRAFO INTEIRO entre export e estrutura: além do NBSP, o
 * export troca tabulação por espaços ("Nome\tNome" vira "Nome         Nome")
 * e apara pontas. Para decidir "é o mesmo parágrafo" isso não importa; para
 * fatiar texto por índice importa — por isso esta normalização NÃO é usada em
 * `findForms`. Medido em produção: o bloco de assinaturas em colunas de um
 * modelo da Trio não casava por causa das tabulações.
 */
export function sameParagraph(a: string, b: string): boolean {
  return collapseWhitespace(a) === collapseWhitespace(b);
}

function collapseWhitespace(text: string): string {
  return normalizeSpaces(text).replace(/\s+/g, " ").trim();
}

/**
 * A forma como `needle` está DE FATO no documento, quando é única lá. É o
 * texto que se manda ao `replaceAllText`: a API não normaliza, e a forma lida
 * pelo export pode não existir no Doc. Ambígua ou ausente → `null` (quem
 * chama mantém a forma que tinha e deixa a reply decidir).
 */
export function realFormOf(realText: string, needle: string): string | null {
  const hit = findForms(realText, needle);
  return hit.count === 1 ? hit.forms[0]! : null;
}

export interface TextSegment {
  text: string;
  /** Índice absoluto da Docs API onde este segmento começa. */
  docsStartIndex: number;
}

/** Os `textRun` do corpo, em ordem, com o índice de origem de cada um. */
export function collectTextSegments(doc: docs_v1.Schema$Document): TextSegment[] {
  const out: TextSegment[] = [];
  for (const block of doc.body?.content || []) {
    const para = block.paragraph;
    if (!para) continue;
    for (const el of para.elements || []) {
      const tr = el.textRun;
      if (!tr || !tr.content) continue;
      if (el.startIndex === undefined || el.startIndex === null) continue;
      out.push({ text: tr.content, docsStartIndex: el.startIndex });
    }
  }
  return out;
}

/** Índice de caractere no texto plano → índice absoluto da Docs API. */
export function charToDocsIndex(segments: TextSegment[], charIdx: number): number {
  let acc = 0;
  for (const seg of segments) {
    const len = seg.text.length;
    if (charIdx <= acc + len) {
      const offset = charIdx - acc;
      return seg.docsStartIndex + offset;
    }
    acc += len;
  }
  // Char index além do texto coletado: fim do último segmento.
  const last = segments[segments.length - 1];
  return last ? last.docsStartIndex + last.text.length : 1;
}

/** O texto plano que os segmentos formam (é o que os índices indexam). */
export function plainTextOf(segments: readonly TextSegment[]): string {
  return segments.map((s) => s.text).join("");
}

export interface ParagraphRange {
  /** Índice absoluto do primeiro caractere do parágrafo. */
  startIndex: number;
  /** Índice absoluto DEPOIS do último caractere, sem incluir a marca de parágrafo. */
  endIndex: number;
}

/**
 * Parágrafos do corpo, com o intervalo de cada um E a posição no `body.content`
 * ORIGINAL.
 *
 * A posição original importa: `body.content` também guarda tabela, quebra de
 * seção e sumário, que não são parágrafo e são pulados aqui. Sem guardar de
 * onde cada parágrafo veio, dois parágrafos com uma TABELA entre eles pareceriam
 * vizinhos — e o intervalo "do primeiro ao último" apagaria a tabela junto.
 */
function paragraphsOf(
  doc: docs_v1.Schema$Document
): Array<{ texto: string; range: ParagraphRange; posicao: number }> {
  const out: Array<{ texto: string; range: ParagraphRange; posicao: number }> = [];
  const content = doc.body?.content || [];
  for (let posicao = 0; posicao < content.length; posicao += 1) {
    const block = content[posicao]!;
    const para = block.paragraph;
    if (!para) continue;
    const elements = (para.elements || []).filter(
      (el) => el.textRun?.content && el.startIndex !== undefined && el.startIndex !== null
    );
    if (elements.length === 0) continue;
    const conteudo = elements.map((el) => el.textRun!.content!).join("");
    const start = elements[0]!.startIndex!;
    const semNewline = conteudo.replace(/\n+$/, "").length;
    out.push({
      texto: conteudo.replace(/\n+$/, "").trim(),
      range: { startIndex: start, endIndex: start + semNewline },
      posicao,
    });
  }
  return out;
}

/** Quebra de linha suave (vertical tab) — o export a mostra como `\n`. */
const SOFT_BREAK_RE = /[\u000B\r]/;

/**
 * Textos não vazios das células de uma tabela, na ordem de leitura (linha a
 * linha), LINHA A LINHA: a quebra de linha suave (`\u000B`, Shift+Enter) fica
 * dentro de um parágrafo na estrutura, mas o export `text/plain` a mostra como
 * linha nova — e é o export que produz os parágrafos do bloco. Medido em
 * produção: "CINDY TAVARES COSTA \u000BPARTE LOCATÁRIA" era um parágrafo no
 * Doc e duas linhas no bloco, e a tabela inteira não casava.
 */
function tableTexts(table: docs_v1.Schema$Table): string[] {
  const out: string[] = [];
  for (const row of table.tableRows || []) {
    for (const cell of row.tableCells || []) {
      for (const block of cell.content || []) {
        const para = block.paragraph;
        if (!para) continue;
        const texto = (para.elements || [])
          .map((el) => el.textRun?.content ?? "")
          .join("")
          .replace(/\n+$/, "");
        for (const linha of texto.split(SOFT_BREAK_RE)) {
          const t = collapseWhitespace(linha);
          if (t) out.push(t);
        }
      }
    }
  }
  return out;
}


/**
 * Intervalo que cobre uma sequência CONSECUTIVA de parágrafos, do início do
 * primeiro ao fim do último.
 *
 * Exigir que sejam consecutivos não é detalhe: sem isso, três parágrafos
 * espalhados pelo documento produziriam um intervalo que engole tudo que está
 * entre eles — e o que está entre eles é contrato. Ambíguo (a mesma sequência
 * aparece duas vezes) devolve `null` pelo mesmo motivo de sempre: apagar
 * intervalo é destrutivo, e escolher um dos dois seria arbitrário.
 *
 * "Consecutivos" é medido no `body.content` ORIGINAL, não na lista já filtrada
 * de parágrafos. A diferença é destrutiva: uma TABELA (ou quebra de seção, ou
 * sumário) entre dois parágrafos não é parágrafo, sai da lista filtrada e os
 * dois pareceriam vizinhos — mas ela ocupa índices no documento, e o intervalo
 * "do primeiro ao último" a apagaria junto. Como a conferência posterior só
 * verifica que os parágrafos PRETENDIDOS sumiram, e nunca que nada além deles
 * sumiu, o estrago seria reportado como sucesso.
 */
export function findBlockRange(
  doc: docs_v1.Schema$Document,
  textos: readonly string[]
): ParagraphRange | null {
  const alvos = textos.map((t) => t.trim()).filter(Boolean);
  if (alvos.length === 0) return null;

  const paras = paragraphsOf(doc);
  const nalvos = alvos.map(collapseWhitespace);
  let achado: ParagraphRange | null = null;

  // Bloco que é uma TABELA inteira: o bloco de assinaturas dos modelos da Trio
  // é uma tabela 3×2 com uma linha de assinatura por célula, e o export
  // `text/plain` a achata em parágrafos, linha a linha, célula a célula. Se os
  // textos das células — na mesma ordem de leitura, sem os vazios — são
  // exatamente o bloco, o intervalo é o da tabela inteira: a API só apaga
  // tabela como unidade, e apagar a unidade é o que se quer. Bloco que cobre
  // só parte de uma tabela não casa aqui (a fatia teria de partir a tabela).
  for (const block of doc.body?.content || []) {
    if (!block.table || block.startIndex == null || block.endIndex == null) continue;
    const textos = tableTexts(block.table);
    if (textos.length !== nalvos.length || !textos.every((t, k) => t === nalvos[k])) continue;
    if (achado) return null;
    achado = { startIndex: block.startIndex, endIndex: block.endIndex };
  }

  for (let i = 0; i < paras.length; i += 1) {
    if (collapseWhitespace(paras[i]!.texto) !== nalvos[0]) continue;
    // Anda pelo `body.content` a partir do primeiro parágrafo casado. Parágrafo
    // VAZIO no meio do bloco é aceito e entra no intervalo: o export do Drive
    // intercala linhas em branco (o bloco de assinaturas é o caso típico, com
    // várias entre uma linha de assinatura e a próxima), e quem manda o bloco
    // vem de `splitDocParagraphs`, que as descarta. Texto diferente, ou
    // qualquer bloco que não seja parágrafo (tabela, quebra de seção — a
    // posição salta), encerra a tentativa: o que está entre os parágrafos
    // seria apagado junto.
    let k = 1;
    let j = i + 1;
    let casa = true;
    while (k < alvos.length) {
      const p = paras[j];
      if (!p || p.posicao !== paras[j - 1]!.posicao + 1) {
        casa = false;
        break;
      }
      if (collapseWhitespace(p.texto) === nalvos[k]) {
        k += 1;
        j += 1;
        continue;
      }
      if (collapseWhitespace(p.texto) === "") {
        j += 1;
        continue;
      }
      casa = false;
      break;
    }
    if (!casa) continue;
    if (achado) return null; // a mesma sequência aparece mais de uma vez
    achado = {
      startIndex: paras[i]!.range.startIndex,
      endIndex: paras[j - 1]!.range.endIndex,
    };
  }
  return achado;
}

/**
 * Intervalo do parágrafo cujo texto, aparado, é exatamente `text`.
 *
 * Devolve `null` quando não existe ou quando aparece em MAIS de um parágrafo:
 * apagar um intervalo é destrutivo e ambiguidade aqui não pode virar escolha
 * arbitrária. A marca de parágrafo fica FORA do intervalo de propósito — quem
 * insere o texto novo no lugar herda a formatação do parágrafo, em vez de
 * fundir-se com o seguinte.
 */
export function findParagraphRange(
  doc: docs_v1.Schema$Document,
  text: string
): ParagraphRange | null {
  const alvo = collapseWhitespace(text);
  if (!alvo) return null;

  let found: ParagraphRange | null = null;
  for (const block of doc.body?.content || []) {
    const para = block.paragraph;
    if (!para) continue;
    const elements = (para.elements || []).filter(
      (el) => el.textRun?.content && el.startIndex !== undefined && el.startIndex !== null
    );
    if (elements.length === 0) continue;

    const conteudo = elements.map((el) => el.textRun!.content!).join("");
    if (collapseWhitespace(conteudo.replace(/\n+$/, "")) !== alvo) continue;
    if (found) return null; // ambíguo: dois parágrafos com o mesmo texto

    const start = elements[0]!.startIndex!;
    // Sem a marca de parágrafo: o `\n` final do último run é o que separa este
    // parágrafo do próximo, e apagá-lo funde os dois.
    const semNewline = conteudo.replace(/\n+$/, "").length;
    found = { startIndex: start, endIndex: start + semNewline };
  }
  return found;
}
