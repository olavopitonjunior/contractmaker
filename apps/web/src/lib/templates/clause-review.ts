/**
 * Revisão da BASE DE CLÁUSULAS: a mesma pergunta do painel de modelos, feita do
 * outro lado do contrato.
 *
 * O modelo é metade do que vai para o PDF; a outra metade vem do acervo. E o
 * acervo tem um modo de falha pior que o do modelo, porque é SILENCIOSO por
 * desenho: cláusula que não compila, que sobra com `{{chave}}` depois do render
 * ou que é uma row chunkada é DESCARTADA na geração e substituída pelo texto
 * canônico (`clause-slots.ts`, item 5 do contrato do mecanismo). A escolha está
 * certa — contrato com a cláusula genérica é melhor que contrato com chave
 * literal —, mas ela transforma um defeito de conteúdo em algo que ninguém vê:
 * o contrato sai bonito, sem a redação que a imobiliária escreveu, e o único
 * registro é uma linha de `console.error` no servidor.
 *
 * Esta revisão adianta a descoberta. Ela roda `checkClauseContent` — a MESMA
 * função que a geração usa para descartar — contra os dados de exemplo do
 * preview. Uma cópia das regras não serviria: o painel precisa concordar com a
 * geração por construção, não por coincidência.
 */
import { prisma } from "@/lib/db/prisma";
import { getPreviewSampleData } from "@/lib/templates/preview-sample-data";
import { auditTemplateText } from "@/lib/templates/pii-gate";
import { maskForReport } from "@/lib/templates/insertion-report";
import { checkClauseContent, type ClauseSlotFailureReason } from "./clause-slots";

/** Em qual esteira a cláusula foi provada (uma linha pode ser lida nas duas). */
export type EsteiraProva = "venda" | "locacao";

export interface ClauseReviewProblem {
  esteira: EsteiraProva;
  reason: ClauseSlotFailureReason;
  /** Mensagem da falha, MASCARADA (pode carregar trecho da cláusula). */
  message: string;
}

export interface ClauseReviewRow {
  clauseId: string;
  title: string;
  /** venda | locacao | ambas | null (não classificada — lida nas duas). */
  esteira: string | null;
  groupCode: string | null;
  /** Slot que esta cláusula preenche (`slot:garantia` → "garantia"). */
  slot: string | null;
  /** Esteiras em que a cláusula foi provada. */
  provadaEm: EsteiraProva[];
  /** Falhas que a geração usaria para DESCARTAR esta cláusula. */
  problemas: ClauseReviewProblem[];
  /**
   * Chaves que resolvem para vazio nos dados de exemplo. Não é falha — a
   * geração aceita — mas é como uma cláusula sai do PDF com uma lacuna no meio
   * da frase sem que nada acuse.
   */
  chavesVazias: string[];
  /** Dado pessoal literal no texto da cláusula (avisa, não bloqueia). */
  temPii: boolean;
  /** Passou em todas as esteiras em que é lida. */
  ok: boolean;
}

export interface ClauseReviewResult {
  rows: ClauseReviewRow[];
  checkedAt: string;
  truncado: boolean;
}

const SLOT_TAG = "slot:";

/**
 * Esteiras em que a linha é efetivamente lida.
 *
 * `null` NÃO é "nenhuma": cláusula não classificada é fail-open e continua
 * sendo lida nas DUAS esteiras (é o que impede um contrato de perder cláusula
 * no dia do deploy). Provar só numa delas deixaria passar exatamente o caso que
 * o fail-open cria.
 */
function esteirasDe(esteira: string | null): EsteiraProva[] {
  if (esteira === "venda") return ["venda"];
  if (esteira === "locacao") return ["locacao"];
  return ["venda", "locacao"];
}

/** Amostra de dados por esteira — a mesma que a prévia dos modelos usa. */
function amostraDe(esteira: EsteiraProva): Record<string, unknown> {
  return getPreviewSampleData(esteira === "locacao" ? "locacao" : "a_vista");
}

/**
 * Caminhos de dado (`{{aluguel.valor}}`) citados no texto.
 *
 * Só o que é inequivocamente um caminho: nada de bloco (`{{#if}}`, `{{/each}}`),
 * de parcial (`{{>`), de comentário (`{{!`) nem de helper com argumento
 * (`{{moeda x}}` tem espaço). O objetivo é achar lacuna silenciosa, e um falso
 * positivo aqui custa a confiança no painel inteiro — na dúvida, não acusa.
 */
function caminhosDe(texto: string): string[] {
  const out = new Set<string>();
  const re = /\{\{\{?\s*([A-Za-z_][\w.]*)\s*\}?\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto))) {
    const caminho = m[1]!;
    if (caminho === "else" || caminho === "this") continue;
    // Sem ponto = pode ser helper sem argumento tanto quanto campo raiz; só
    // acusamos caminho aninhado, onde a intenção de ler um dado é clara.
    if (!caminho.includes(".")) continue;
    out.add(caminho);
  }
  return [...out];
}

function resolveCaminho(data: Record<string, unknown>, caminho: string): unknown {
  let atual: unknown = data;
  for (const parte of caminho.split(".")) {
    if (atual == null || typeof atual !== "object") return undefined;
    atual = (atual as Record<string, unknown>)[parte];
  }
  return atual;
}

/**
 * Revisa as cláusulas do acervo DA ORG.
 *
 * As da plataforma (orgId null) ficam de fora: elas entram como lacuna quando o
 * tenant não tem cláusula para o slot, mas o tenant não pode corrigi-las — uma
 * lista de problemas que o operador não tem como resolver é ruído.
 */
export async function reviewClauseLibrary(input: {
  orgId: string;
  max?: number;
}): Promise<ClauseReviewResult> {
  const { orgId, max = 400 } = input;

  const clausulas = await prisma.knowledgeItem.findMany({
    where: { orgId, category: "clause", status: "approved", parentId: null },
    orderBy: [{ esteira: "asc" }, { title: "asc" }],
    take: max + 1,
    select: {
      id: true,
      title: true,
      content: true,
      esteira: true,
      groupCode: true,
      tags: true,
      chunkTotal: true,
    },
  });
  const truncado = clausulas.length > max;
  const alvo = truncado ? clausulas.slice(0, max) : clausulas;

  const rows = alvo.map((c): ClauseReviewRow => {
    const provadaEm = esteirasDe(c.esteira);
    const problemas: ClauseReviewProblem[] = [];
    const vazias = new Set<string>();

    for (const esteira of provadaEm) {
      const data = amostraDe(esteira);
      const out = checkClauseContent(
        { id: c.id, content: c.content, chunkTotal: c.chunkTotal, tags: c.tags },
        data
      );
      if (!("html" in out)) {
        problemas.push({ esteira, reason: out.reason, message: maskForReport(out.message) });
        continue;
      }
      for (const caminho of caminhosDe(c.content)) {
        const v = resolveCaminho(data, caminho);
        if (v === undefined || v === null || v === "") vazias.add(caminho);
      }
    }

    const slotTag = (c.tags ?? []).find((t) => t.startsWith(SLOT_TAG));
    return {
      clauseId: c.id,
      title: c.title,
      esteira: c.esteira,
      groupCode: c.groupCode,
      slot: slotTag ? slotTag.slice(SLOT_TAG.length) : null,
      provadaEm,
      problemas,
      chavesVazias: [...vazias].sort(),
      temPii: auditTemplateText(c.content).blocked,
      ok: problemas.length === 0,
    };
  });

  return { rows, checkedAt: new Date().toISOString(), truncado };
}
