/**
 * Router do graph multi-agente. Classifica a mensagem do usuário pra
 * decidir qual especialista invocar. Reusa as regexes que o agente legacy
 * já usa em `agent.ts:480-484` pra detectar comando de edição.
 *
 * Intents:
 * - `informational` — pergunta, lista, explicação. Sem verbo de edição.
 *   Roteia pra `legal` (read-only). Garantido pela regra 10.1 de `prompts.ts`.
 * - `edit_simple` — verbo imperativo + alvo claro, 1 mudança. Roteia pra
 *   `editor`.
 * - `edit_multi` — verbo de edição + sinais de múltiplas mudanças (lista,
 *   "e também", "revise tudo"). Roteia pra `propose_plan` (subgraph F2).
 * - `review` — pedido explícito de análise sem editar ("analise",
 *   "revise sem alterar"). Reads paralelos em analyst+legal+curator, sem editor.
 */

import type { OrchestratorState } from "./state";

export type Intent = NonNullable<OrchestratorState["intent"]>;

/** Verbos imperativos de edição. Mesma regex de `agent.ts:480-481`.
 *  2026-05 (QA deal 20486): incluídos preencha/preencher/complete/informe/
 *  defina/registre/ajuste/conserte/escreva — "Preencha o local e a data" caía
 *  em informational e o Editor nunca rodava (confabulação no aggregator). */
// Verbos pré-existentes mantidos como imperativos (não adicionar infinitivos
// como "mudar"/"alterar": quebram "considere mudar" → deveria ser propose).
// Famílias NOVAS de preenchimento incluem infinitivo (baixa colisão com propose).
const EDIT_INTENT_REGEX =
  /\b(altere|mude|troque|substitua|atualize|corrija|modifique|remova|insira|adicione|coloque|ponha|apague|delete|reescreva|inclua|retire|exclua|preencha|preencher|preenche|complete|completar|completa|informe|informar|defina|definir|registre|registrar|ajuste|ajustar|conserte|consertar|escreva|escrever)\b/i;

/**
 * Pedido explícito de edição imediata sem revisão — o escape do modo Planejar.
 *
 * Termina em `(?!\w)` e NÃO em `\b`: as alternativas que acabam em vogal
 * acentuada ("aplique já", "faça já") nunca casavam, porque `á` não é
 * caractere de palavra em JS e a fronteira `\b` exigia a transição
 * palavra→não-palavra que ali não existe. Passou despercebido enquanto o
 * escape era só uma preferência de prompt; com o gate do modo Planejar
 * (`specialists/editor.ts::resolveEditorToolPolicy`) ele é a única saída.
 */
const FORCE_DIRECT_EDIT_REGEX =
  /\b(aplique\s+direto|aplique\s+já|faça\s+já|faça\s+agora|sem\s+revis[ãa]o|edite\s+direto|altere\s+agora|aplica\s+direto|sem\s+sugest[ãa]o)(?!\w)/i;

/**
 * Remove trechos CITADOS antes de procurar o escape.
 *
 * A regex casa em qualquer posição da mensagem, e várias das expressões são
 * frases de contrato ("rescisão automática SEM REVISÃO judicial", "aceite SEM
 * SUGESTÃO de alteração"). Colar uma cláusula assim entre aspas — vinda da
 * contraparte, ou do campo de observações do formulário público, que é
 * anônimo — ligava o escape e derrubava o gate do modo Planejar sem que
 * ninguém tivesse pedido edição direta.
 *
 * O pedido real ("aplique direto: ...") é sempre texto do próprio usuário,
 * fora de aspas; conteúdo de terceiro é o que vem citado. Daí a assimetria.
 *
 * Aspas simples só são removidas em trechos longos: apóstrofo em português
 * ("d'água", "pingo d'água") não pode comer o resto da mensagem.
 */
export function stripQuotedSpans(message: string): string {
  return message
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/"[^"]*"/g, " ")
    .replace(/[“”][^“”]*[“”]/g, " ")
    .replace(/«[^»]*»/g, " ")
    .replace(/'[^']{20,}'/g, " ")
    .replace(/[‘’][^‘’]{20,}[‘’]/g, " ");
}

/** O escape vale só quando pedido fora de citação — ver stripQuotedSpans. */
export function wantsDirectEdit(message: string): boolean {
  return FORCE_DIRECT_EDIT_REGEX.test(stripQuotedSpans(message));
}

/** Pedido explícito de análise sem edição. */
const REVIEW_INTENT_REGEX =
  /\b(analise|revise|avalie|verifique|valide|cheque|confira)\b/i;

/** Pedido de proposta — vai pro Curator pra criar pending proposal. */
const PROPOSE_INTENT_REGEX =
  /\b(proponha|sugira|recomende|considere|crie\s+(?:uma|um)\s+proposta)\b/i;

/** Aditamento — operação de write neste contrato (não proposta pra biblioteca).
 *  Quando match, força edit_simple no roteamento, mesmo com verbo "proponha". */
const ADITAMENTO_REGEX =
  /\b(aditamento|aditivo|adendo|cl[áa]usula\s+adicional)\b/i;

/** Contexto de certidões — quando o usuário menciona "certid", deal precisa
 *  passar pelo Editor (com cross_check_certidoes) pra ações concretas. */
const CERTIDOES_CONTEXT_REGEX =
  /\b(certid[ãa]o|certid[õo]es|matr[íi]cula|ônus|gravame|penhora|aliena[çc][ãa]o\s+fiduci[áa]ria)\b/i;

/** Pergunta interrogativa (PT-BR e EN). */
const QUESTION_REGEX =
  /^(o\s+que|qual|quais|como|onde|quando|por\s+que|porque|quem|how|what|where|when|why|who|which)\b/i;

/** Sinais de múltiplas edições no mesmo turn. */
const MULTI_EDIT_HINTS_REGEX =
  /\b(todas|tudo|cada|revis[ãa]o\s+completa|geral|também|e\s+também|além\s+disso|ainda)\b/i;

/**
 * Heurística pura — classifica intent sem chamar LLM. Em F1 a precisão
 * exigida é só "manda pro especialista certo"; o especialista refina.
 *
 * Em F2/F3 pode-se adicionar um classifier LLM (Haiku) pra casos ambíguos,
 * mas o ROI é baixo: mensagens claras dominam.
 */
export function classifyIntent(message: string): Intent {
  const msg = message.trim();

  // 1. Pergunta com "?" ou começa com interrogativo → informational.
  if (msg.endsWith("?") || QUESTION_REGEX.test(msg)) {
    return "informational";
  }

  // 2. Aditamento (escrita NESTE contrato) — tem precedência sobre propose.
  //    Vai pro Editor que chama cross_check_certidoes + propose_suggestion em 1 turn.
  if (ADITAMENTO_REGEX.test(msg)) {
    return "edit_simple";
  }

  // 3. Pedido de proposta (curator) — explicitamente para template/biblioteca.
  //    Tem precedência sobre review/edit quando o verbo é "proponha"/"sugira".
  if (PROPOSE_INTENT_REGEX.test(msg) && !EDIT_INTENT_REGEX.test(msg)) {
    return "propose";
  }

  // 4. Pedido explícito de análise sem editar.
  if (REVIEW_INTENT_REGEX.test(msg) && !EDIT_INTENT_REGEX.test(msg)) {
    return "review";
  }

  // 5. Verbo de edição → simple vs multi.
  if (EDIT_INTENT_REGEX.test(msg)) {
    if (MULTI_EDIT_HINTS_REGEX.test(msg) || FORCE_DIRECT_EDIT_REGEX.test(msg) === false && msg.length > 200) {
      return "edit_multi";
    }
    return "edit_simple";
  }

  // 6. Sem nenhum sinal → trata como informational (mais seguro).
  return "informational";
}

/** Re-export pra outros módulos consumirem sem duplicar regex. */
export const ROUTER_REGEXES = {
  EDIT_INTENT: EDIT_INTENT_REGEX,
  FORCE_DIRECT_EDIT: FORCE_DIRECT_EDIT_REGEX,
  REVIEW_INTENT: REVIEW_INTENT_REGEX,
  PROPOSE_INTENT: PROPOSE_INTENT_REGEX,
  ADITAMENTO: ADITAMENTO_REGEX,
  CERTIDOES_CONTEXT: CERTIDOES_CONTEXT_REGEX,
  QUESTION: QUESTION_REGEX,
  MULTI_EDIT_HINTS: MULTI_EDIT_HINTS_REGEX,
} as const;
