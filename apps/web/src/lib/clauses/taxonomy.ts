/**
 * Taxonomia do acervo de cláusulas POR ESTEIRA.
 *
 * O acervo sempre teve uma única estrutura declarada — os grupos `G1..G6` — e
 * ela é 100% de COMPRA E VENDA (Sinal/Arras, Imissão na Posse, Financiamento e
 * Registro...). `seed-clauses-locacao.ts` diz isso explicitamente e grava
 * `groupCode: null`. O efeito colateral era grave: a tela abria por default numa
 * aba que, num tenant de locação, é sempre vazia, e o system prompt afirmava a
 * TODO tenant que "o banco contém 23 cláusulas em 6 grupos".
 *
 * Este módulo é a fonte ÚNICA do eixo organizador de cada esteira — consumido
 * pela UI de `/clauses`, pelo classificador e pelos prompts, pra que os três não
 * divirjam (o fork das listas já foi achado de review em `CLAUSE_PREVIEW_MODALIDADES`).
 *
 * Dado puro, client-safe: sem prisma, sem imports de servidor.
 *
 * ## Por que locação NÃO ganha um "L1..L6"
 *
 * Inventar um segundo conjunto de códigos duplicaria justamente o erro que este
 * módulo existe pra corrigir, num domínio onde a recuperação já é semântica. E
 * não amarraria nada: em locação quem liga o formulário ao contrato é a tag de
 * slot (`slot:garantia` + `garantia:<tipo>`), não um código de grupo. O eixo de
 * locação já existe no dado — é a `subcategory` dos seeds.
 */
import {
  templateFamilyForModalidade,
  type TemplateFamily,
} from "@/lib/contracts/template-category";
import type { FormModule } from "@/lib/forms/presets";
import {
  GROUP_LABELS,
  CLAUSE_GROUP_CODES,
  CLAUSE_ESTEIRA_VALUES,
} from "@/lib/clauses/schema";

/**
 * Esteira do acervo. `FormModule` ("venda" | "locacao") é o tipo canônico de
 * esteira do produto (`lib/forms/presets.ts`) — reusado de propósito, pra não
 * nascer um enum paralelo. `"ambas"` é o terceiro estado do ACERVO (não do
 * formulário): cláusula comum às duas esteiras — foro, assinatura eletrônica,
 * LGPD. É UMA linha só, lida nas duas visões; nunca duplicada.
 */
export type ClauseEsteira = (typeof CLAUSE_ESTEIRA_VALUES)[number];

export const CLAUSE_ESTEIRAS: readonly ClauseEsteira[] = CLAUSE_ESTEIRA_VALUES;

export const ESTEIRA_LABEL: Record<ClauseEsteira, string> = {
  venda: "Compra e venda",
  locacao: "Locação",
  ambas: "Comum às duas esteiras",
};

/** Um agrupamento dentro do eixo de uma esteira. */
export interface EsteiraGroup {
  /** Valor gravado no dado: `groupCode` em venda, `subcategory` em locação. */
  code: string;
  label: string;
  /** Regra de negócio mostrada ao humano no cabeçalho da seção (não em tooltip). */
  help?: string;
}

/**
 * De qual COLUNA sai o agrupamento da esteira. Venda agrupa por `groupCode`
 * (o roteiro do CCV); locação agrupa por `subcategory` (tema jurídico).
 */
export type EsteiraAxis =
  | { kind: "groupCode"; groups: readonly EsteiraGroup[] }
  | { kind: "subcategory"; groups: readonly EsteiraGroup[] };

/**
 * Roteiro do CCV. Os rótulos vêm de `GROUP_LABELS` (fonte única, já compartilhada
 * com o Select do editor) — aqui só se acrescenta a regra de negócio do G4, que
 * até hoje só existia dentro do system prompt e nunca foi dita ao usuário.
 */
const VENDA_GROUPS: readonly EsteiraGroup[] = CLAUSE_GROUP_CODES.map((code) => ({
  code,
  label: GROUP_LABELS[code] ?? code,
  help:
    code === "G4"
      ? "Obrigatório em contratos com financiamento."
      : undefined,
}));

/**
 * Temas de locação — derivados das `subcategory` que os seeds da Lei 8.245/91 já
 * usam (`seed-clauses-locacao.ts`). Lista FECHADA pro Select e pro agrupamento;
 * `subcategory` fora dela continua válida no banco (o schema é permissivo de
 * propósito, por causa das safras legadas) e cai no bucket "Outros temas".
 */
const LOCACAO_GROUPS: readonly EsteiraGroup[] = [
  { code: "garantia", label: "Garantia locatícia", help: "Só uma modalidade por contrato (art. 37 da Lei 8.245/91)." },
  { code: "reajuste", label: "Reajuste e índice" },
  { code: "encargos", label: "Encargos e despesas" },
  { code: "uso", label: "Uso e destinação do imóvel" },
  { code: "vistoria", label: "Vistoria e conservação" },
  { code: "benfeitorias", label: "Benfeitorias" },
  { code: "rescisao", label: "Rescisão e multa" },
  { code: "devolucao", label: "Devolução do imóvel" },
  { code: "preferencia", label: "Direito de preferência" },
  { code: "renovatoria", label: "Ação renovatória" },
];

export const ESTEIRA_AXIS: Record<FormModule, EsteiraAxis> = {
  venda: { kind: "groupCode", groups: VENDA_GROUPS },
  locacao: { kind: "subcategory", groups: LOCACAO_GROUPS },
};

/**
 * Fixture de preview PRIMÁRIO de cada esteira — o contexto contra o qual uma
 * chave sugerida precisa resolver pra ser considerada `validada`.
 * Espelha `CLAUSE_PREVIEW_MODALIDADES` (`lib/clauses/schema.ts`).
 */
export const ESTEIRA_PRIMARY_FIXTURE: Record<FormModule, string> = {
  venda: "a_vista",
  locacao: "locacao",
};

/** Todos os fixtures de cada esteira — os secundários geram chave `condicional`. */
export const ESTEIRA_FIXTURES: Record<FormModule, readonly string[]> = {
  venda: ["a_vista", "financiamento"],
  locacao: ["locacao", "locacao_comercial", "temporada", "administracao_locacao"],
};

/**
 * Modalidade → esteira. Construído sobre `templateFamilyForModalidade`, que já é
 * a autoridade do repo sobre família de modalidade — inclusive sobre o caso não
 * óbvio de `administracao_locacao`, que apesar do prefixo É locação
 * (`LOCACAO_MODALIDADES` o inclui).
 *
 * `proposta_*` devolve `null`: proposta não é contrato e não deve estreitar a
 * busca do agente.
 */
export function esteiraForModalidade(
  modalidade: string | null | undefined
): FormModule | null {
  if (!modalidade) return null;
  const family: TemplateFamily = templateFamilyForModalidade(modalidade);
  if (family === "venda") return "venda";
  if (family === "locacao") return "locacao";
  return null;
}

/** Sinais de onde a esteira pode ser inferida em tempo de execução. */
export interface EsteiraSignals {
  /** `Deal.kind` — CUIDADO: o caller pode já ter defaultado pra "venda". */
  dealKind?: string | null;
  /** `ContractTemplate.modalidade` — o sinal mais confiável. */
  templateModalidade?: string | null;
}

/**
 * Esteira de um contrato, para DIRECIONAR a busca do agente.
 *
 * ## Fail-open é obrigatório aqui
 *
 * `lib/ai/shared/context.ts` monta o contexto com `contract.deal?.kind ?? "venda"`
 * — ou seja, contrato SEM deal chega aqui parecendo venda. Se confiássemos nisso,
 * o filtro esconderia o acervo de locação em silêncio, e "o agente não acha a
 * cláusula" é um bug caríssimo de diagnosticar.
 *
 * Pior: `templateModalidade` tem o MESMO problema no mesmo arquivo —
 * `contract.template?.modalidade || "a_vista"`. Contrato IMPORTADO (upload
 * externo) não tem template, então chega aqui parecendo venda à vista. Uma
 * locação importada, com `deal.kind = "locacao"` correto, perderia todo o
 * acervo de locação em toda conversa daquele contrato.
 *
 * Por isso esta função precisa receber os valores **CRUS** (`?? null`), antes
 * de qualquer default — é o que `buildAgentContext` faz, gravando o resultado
 * em `AgentContext.esteira`. Os consumidores leem esse campo pronto; não
 * recalculam a partir do contexto já defaultado.
 *
 * Regras: sem sinal → `null` (não filtra); sinais contraditórios → `null`
 * também. Nunca "simplificar" para um `?? "venda"`.
 */
export function esteiraForContext(signals: EsteiraSignals): FormModule | null {
  const byModalidade = esteiraForModalidade(signals.templateModalidade);

  const kind = (signals.dealKind ?? "").trim().toLowerCase();
  const byDeal: FormModule | null =
    kind === "locacao" ? "locacao" : kind === "venda" ? "venda" : null;

  // Sinais que se contradizem = dado inconsistente. Não se escolhe um lado:
  // não filtrar é sempre recuperável, esconder o acervo errado não é.
  if (byModalidade && byDeal && byModalidade !== byDeal) return null;

  return byModalidade ?? byDeal;
}

/**
 * Esteiras que uma consulta deve enxergar. Sempre inclui `"ambas"`; o chamador
 * é quem acrescenta o "não classificada" (`esteira IS NULL`), que também passa
 * — cláusula sem triagem nunca pode sumir do agente.
 */
export function visibleEsteiras(esteira: FormModule): ClauseEsteira[] {
  return [esteira, "ambas"];
}

/** Eixo da esteira, com os grupos na ordem de exibição. */
export function axisFor(esteira: FormModule): EsteiraAxis {
  return ESTEIRA_AXIS[esteira];
}

/**
 * Em qual grupo do eixo a cláusula cai. `null` = "sem grupo nesta esteira"
 * (bucket próprio na UI, não sumiço — o buraco da partição antiga).
 */
export function groupCodeFor(
  esteira: FormModule,
  clause: { groupCode?: string | null; subcategory?: string | null }
): string | null {
  const axis = ESTEIRA_AXIS[esteira];
  const value = axis.kind === "groupCode" ? clause.groupCode : clause.subcategory;
  if (!value) return null;
  return axis.groups.some((g) => g.code === value) ? value : null;
}

/**
 * O `groupCode` que pode ser PERSISTIDO para uma dada esteira — `null` quando
 * o par não se sustenta. É a REGRA ÚNICA do eixo: `isEsteiraConsistent` só
 * pergunta se ela devolveria o valor intacto, então detector e guarda nunca
 * podem divergir.
 *
 * A regra tem duas metades, e cada esteira só aceita o eixo que ela de fato
 * exibe:
 *
 * - **venda** agrupa por `groupCode` e o eixo é o roteiro do CCV. Só G1..G6
 *   vale. Qualquer outro valor é taxonomia de outro acervo — o curado usa
 *   'GARANTIA' e 'OPCIONAL' — e denuncia justamente a linha que não deveria
 *   estar em venda.
 * - **locação, ambas e triagem** agrupam por `subcategory`. Um `G4` pendurado
 *   ali não é exibido por eixo nenhum, então cai. Mas a taxonomia própria do
 *   acervo curado FICA: é dado do curador, e a migration de correção a preserva
 *   de propósito (ela move a esteira, nunca o grupo). Apagá-la aqui poria a
 *   guarda em contradição com a migration — achado de review.
 *
 * ## Por que isto existe
 *
 * O backfill original presumiu "ter groupCode é, por construção, ser cláusula
 * de CCV" e mandou 37 cláusulas de locação de dois tenants para a esteira de
 * venda em PRODUÇÃO. Nada falhou: o filtro do RAG é
 * `esteira IN (<a do contrato>, 'ambas') OR IS NULL`, então elas apenas
 * pararam de aparecer na busca do agente em contrato de locação. A migration
 * `20260902013000_knowledge_item_esteira_fix_group_code` desfez o dado.
 *
 * A regra era ASSIMÉTRICA nos caminhos de escrita, e era por aí que o estado
 * voltava: `classify/apply` limpava o grupo ao SAIR de venda mas não conferia
 * nada ao ENTRAR, e o `PATCH` preservava o valor do banco verbatim quando o
 * body não mencionava `groupCode`. Aprovar só o campo `esteira` numa cláusula
 * curada bastava — e quem propõe é um LLM.
 *
 * Note a diferença para a premissa furada: aqui a inferência é sobre G1..G6, um
 * conjunto FECHADO que é o roteiro do CCV por definição, e não sobre "tem
 * algum groupCode".
 */
export function groupCodeForEsteira(
  esteira: string | null | undefined,
  groupCode: string | null | undefined
): string | null {
  if (!groupCode) return null;
  const doRoteiroCcv = (CLAUSE_GROUP_CODES as readonly string[]).includes(groupCode);
  return esteira === "venda" ? (doRoteiroCcv ? groupCode : null) : doRoteiroCcv ? null : groupCode;
}

/**
 * Cláusula cujo `groupCode` não pertence ao eixo da própria `esteira`.
 *
 * Detector puro, derivado da MESMA regra da guarda — se `groupCodeForEsteira`
 * devolveria outra coisa, o par gravado está errado.
 *
 * A detecção é PARCIAL por construção: cláusula de locação marcada 'venda' com
 * `groupCode` nulo é invisível aqui. O escopo casa com este incidente — a regra
 * furada só tocou linhas com `groupCode` não nulo — e não com "esteira errada"
 * em geral.
 */
export function isEsteiraConsistent(clause: {
  esteira?: string | null;
  groupCode?: string | null;
}): boolean {
  return groupCodeForEsteira(clause.esteira, clause.groupCode) === (clause.groupCode ?? null);
}

/** As que violam o invariante, na ordem recebida. */
export function findEsteiraInconsistencies<
  T extends { esteira?: string | null; groupCode?: string | null },
>(clauses: readonly T[]): T[] {
  return clauses.filter((c) => !isEsteiraConsistent(c));
}

/**
 * Esteira DEDUZÍVEL das tags, ou `null` quando não há evidência.
 *
 * Espelha as regras do backfill em SQL, para que o seed do acervo curado
 * classifique na ORIGEM o que a migration teve de consertar no destino: hoje
 * `scripts/seed-acervo-clausulas.ts` não grava `esteira` nenhuma, então um
 * tenant novo que receba o pacote curado de locação nasce com as mesmas linhas
 * sem esteira — e a migration não estará lá para classificá-las (achado de
 * review).
 *
 * Só as tags de IDENTIDADE contam. `slot:`, `garantia:` e `cobertura:` são de
 * garantia locatícia (`CLAUSE_SLOT_KEYS` tem uma chave só, "garantia", e ela é
 * de locação); `locacao:` declara a esteira no próprio prefixo. Nada de
 * heurística de texto: sem evidência, devolve `null`, que é a fila de triagem
 * e é lida nas duas esteiras.
 */
export function esteiraFromTags(tags: readonly string[]): ClauseEsteira | null {
  const temSlotLocaticio = tags.some(
    (t) => t.startsWith("slot:") || t.startsWith("garantia:") || t.startsWith("cobertura:")
  );
  if (temSlotLocaticio) return "locacao";
  if (tags.some((t) => t.startsWith("locacao:") || t === "locacao")) return "locacao";
  return null;
}
