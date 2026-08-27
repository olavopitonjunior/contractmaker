/**
 * Playbook de família — o conhecimento do PROCESSO, versionado no repo.
 *
 * O planner (Fase A2) é uma chamada de LLM, e o que o distingue de um chute é
 * o que vai no prompt. Esse conteúdo não pode viver dentro da função que faz a
 * chamada: ele muda por motivo de NEGÓCIO ("a partir de agora garantia onerosa
 * também separa modelo"), precisa passar por revisão de quem entende do
 * assunto, e tem de ser diffável. Daí um arquivo por família.
 *
 * Cada playbook carrega DUAS coisas que não podem divergir:
 *
 * 1. **Os parâmetros** (`allowedSlots`, `criteriaAxes`, `requiresGarantia`) —
 *    lidos pelos GUARDRAILS determinísticos, que rodam sobre o plano depois.
 * 2. **O texto do prompt** — lido pelo modelo.
 *
 * Estarem no mesmo objeto é deliberado: a regra que o prompt PEDE e a regra que
 * o guardrail COBRA saem da mesma linha do mesmo arquivo. Quando divergem, o
 * modelo produz planos que são sistematicamente rejeitados e ninguém entende
 * por quê.
 *
 * Módulo puro: sem prisma, sem rede.
 */

import type { CriteriaField } from "@/lib/templates/ingestion-types";
import type { ClauseSlotKey } from "@/lib/templates/clause-slots";

/**
 * Famílias de playbook. Não é `TemplateFamily` de `template-category.ts`: lá
 * `administracao_locacao` cai em "locacao" (é uma modalidade de locação), mas
 * aqui ele precisa de playbook PRÓPRIO — o contrato entre imobiliária e
 * proprietário não tem garantia locatícia, e oferecer o eixo `garantia` a ele
 * convidaria o modelo a inventar uma.
 */
export const PLAYBOOK_FAMILIES = [
  "locacao",
  "venda",
  "administracao",
  "proposta",
] as const;
export type PlaybookFamily = (typeof PLAYBOOK_FAMILIES)[number];

export interface IngestionPlaybook {
  family: PlaybookFamily;
  /** Modalidades canônicas que esta família cobre. */
  modalidades: readonly string[];
  /** Slots que o plano pode abrir aqui. Fora desta lista vira `slot_not_applicable`. */
  allowedSlots: readonly ClauseSlotKey[];
  /** Eixos de `matchCriteria` legítimos nesta família. */
  criteriaAxes: readonly CriteriaField[];
  /** `matchCriteria.garantia` é OBRIGATÓRIA em todo template desta família. */
  requiresGarantia: boolean;
  /**
   * O texto que vai no bloco ESTÁVEL do system prompt (o cacheável). Escrito em
   * PT-BR porque o corpus, o vocabulário do domínio e quem revisa o arquivo são
   * em PT-BR.
   */
  prompt: string;
}
