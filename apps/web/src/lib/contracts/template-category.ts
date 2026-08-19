/**
 * Seleção determinística de template por categoria (forma de pagamento →
 * template), sem heurística/agente. A composição de `pagamento.parcelas[].tipo`
 * mapeia para uma categoria; a categoria puxa o template correspondente; se
 * não houver template da categoria, cai no PRINCIPAL DO GRUPO.
 *
 *   Grupo "sem alienação fiduciária" (modalidade a_vista):
 *     compra_e_venda · permuta · outros
 *   Grupo "com alienação fiduciária" (modalidade financiamento):
 *     financiamento · fgts · consorcio
 */
import { z } from "zod";
import type { ContractTemplate } from "@prisma/client";
// `prisma` é importado de forma lazy dentro de selectTemplateForDeal pra manter
// este módulo client-safe (as constantes/labels são usadas na UI de templates).

export const TEMPLATE_CATEGORIES = [
  "compra_e_venda",
  "permuta",
  "outros",
  "financiamento",
  "fgts",
  "consorcio",
] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export type TemplateGroup = "sem_alienacao" | "com_alienacao";

export const CATEGORY_TO_GROUP: Record<TemplateCategory, TemplateGroup> = {
  compra_e_venda: "sem_alienacao",
  permuta: "sem_alienacao",
  outros: "sem_alienacao",
  financiamento: "com_alienacao",
  fgts: "com_alienacao",
  consorcio: "com_alienacao",
};

export const GROUP_TO_MODALIDADE: Record<TemplateGroup, "a_vista" | "financiamento"> = {
  sem_alienacao: "a_vista",
  com_alienacao: "financiamento",
};

export const CATEGORY_LABELS: Record<TemplateCategory, string> = {
  compra_e_venda: "Contrato de compra e venda",
  permuta: "Com permuta",
  outros: "Outros tipos",
  financiamento: "Contrato de financiamento",
  fgts: "Fundo de garantia (FGTS)",
  consorcio: "Consórcio",
};

export const GROUP_LABELS: Record<TemplateGroup, string> = {
  sem_alienacao: "Sem alienação fiduciária",
  com_alienacao: "Com alienação fiduciária",
};

export function isTemplateCategory(v: unknown): v is TemplateCategory {
  return typeof v === "string" && (TEMPLATE_CATEGORIES as readonly string[]).includes(v);
}

export function modalidadeForCategory(category: TemplateCategory): "a_vista" | "financiamento" {
  return GROUP_TO_MODALIDADE[CATEGORY_TO_GROUP[category]];
}

/**
 * Deriva a categoria a partir da composição de parcelas do pagamento.
 * Prioridade (uma parcela pode ter vários tipos no mesmo negócio):
 *   consórcio > financiamento > FGTS > permuta > outros > compra e venda.
 * FGTS isolado → fgts; FGTS junto com financiamento → financiamento
 * (FGTS é fonte dentro do financiado).
 */
export function deriveCategoryFromPayment(dataJson: unknown): TemplateCategory {
  const data = (dataJson && typeof dataJson === "object" ? dataJson : {}) as {
    pagamento?: { parcelas?: Array<{ tipo?: unknown }>; banco_financiamento?: unknown };
  };
  const pagamento = data.pagamento ?? {};
  const tipos = new Set(
    (pagamento.parcelas ?? [])
      .map((p) => (typeof p?.tipo === "string" ? p.tipo : ""))
      .filter(Boolean)
  );
  const hasBanco =
    typeof pagamento.banco_financiamento === "string" &&
    pagamento.banco_financiamento.trim().length > 0;

  if (tipos.has("cessao_consorcio")) return "consorcio";
  if (tipos.has("financiamento") || hasBanco) return "financiamento";
  if (tipos.has("fgts")) return "fgts";
  if (tipos.has("permuta_veiculo") || tipos.has("permuta_imovel")) return "permuta";
  if (tipos.has("outros")) return "outros";
  return "compra_e_venda";
}

/**
 * Categoria final = heurística das parcelas + a ESCOLHA HUMANA como prior.
 *
 * O seletor de modalidade da etapa Pagamento grava `dataJson.modalidade`; a
 * heurística continua a autoridade sobre a categoria FINA (consórcio, FGTS,
 * permuta), mas quando o usuário declarou "financiamento" e as parcelas não
 * carregam nenhum sinal do grupo com alienação (form antigo editado à mão,
 * OCR que perdeu o tipo da parcela), a declaração vence e puxa o grupo.
 *
 * `modalidade: "a_vista"` NÃO sobrescreve a heurística de propósito: consórcio
 * e FGTS pertencem ao grupo "com alienação" mesmo sem financiamento bancário, e
 * o default `.default("a_vista")` do Zod tornaria qualquer form legado capaz de
 * rebaixar um financiamento real. Ausente → comportamento anterior, byte a byte.
 */
export function deriveCategory(dataJson: unknown): TemplateCategory {
  const heuristic = deriveCategoryFromPayment(dataJson);
  const modalidade = (dataJson && typeof dataJson === "object"
    ? (dataJson as { modalidade?: unknown }).modalidade
    : undefined);
  if (
    modalidade === "financiamento" &&
    CATEGORY_TO_GROUP[heuristic] !== "com_alienacao"
  ) {
    return "financiamento";
  }
  return heuristic;
}

export interface TemplateLite {
  id: string;
  category: string | null;
  modalidade: string | null;
  isDefault: boolean;
  status: string;
}

/**
 * Resolver puro (testável): escolhe o template para a categoria seguindo
 *   1) match exato de categoria (preferindo isDefault),
 *   2) PRINCIPAL DO GRUPO (template isDefault da mesma modalidade/grupo),
 *   3) default geral da org.
 * Retorna o id escolhido ou null. Ex.: consórcio sem template → principal de
 * "com alienação fiduciária" (= financiamento).
 */
export function resolveTemplateId(
  category: TemplateCategory,
  templates: TemplateLite[]
): string | null {
  const active = templates.filter((t) => t.status === "active");
  if (active.length === 0) return null;

  const byCat = active.filter((t) => t.category === category);
  if (byCat.length) return (byCat.find((t) => t.isDefault) ?? byCat[0]).id;

  const modal = modalidadeForCategory(category);
  const byGroup = active.filter((t) => (t.modalidade ?? "a_vista") === modal);
  const groupPrincipal = byGroup.find((t) => t.isDefault) ?? byGroup[0];
  if (groupPrincipal) return groupPrincipal.id;

  return (active.find((t) => t.isDefault) ?? active[0]).id;
}

/**
 * Seleção determinística para um deal: categoria ← pagamento, template ←
 * resolveTemplateId. Retorna o template completo + a categoria resolvida.
 */
export async function selectTemplateForDeal(
  orgId: string,
  dataJson: unknown
): Promise<{ template: ContractTemplate; category: TemplateCategory } | null> {
  const category = deriveCategory(dataJson);
  const { prisma } = await import("@/lib/db/prisma");
  const templates = await prisma.contractTemplate.findMany({
    where: { orgId, status: "active" },
  });
  if (templates.length === 0) return null;
  const chosenId = resolveTemplateId(
    category,
    templates.map((t) => ({
      id: t.id,
      category: t.category,
      modalidade: t.modalidade,
      isDefault: t.isDefault,
      status: t.status,
    }))
  );
  const template = templates.find((t) => t.id === chosenId);
  return template ? { template, category } : null;
}

// ============================================================================
// CRITÉRIO DE SELEÇÃO PELAS ESCOLHAS DO FORM (locação e proposta).
//
// Em venda o discriminador é a forma de pagamento (`category`). Em locação e
// proposta a modalidade sozinha é ambígua: a mesma "proposta de locação
// residencial" tem variantes por garantia (com fiador × sem), pela natureza do
// locatário/proponente (PF × PJ) e pela do próprio fiador — caso real da
// RE/MAX Ativa ("PF com fiador PJ"), onde a escolha caía no `isDefault` e o
// operador trocava o template à mão.
//
// `ContractTemplate.matchCriteria` guarda esses critérios; o form entrega os
// FATOS; o scoring cruza os dois. Critério ausente = template genérico.
// ============================================================================
export const GARANTIA_TIPOS = [
  "fiador",
  "caucao",
  "seguro_fianca",
  "garantia_digital",
  "titulo_capitalizacao",
  "propria",
  "sem_garantia",
] as const;
export type GarantiaTipo = (typeof GARANTIA_TIPOS)[number];

// Espelha `garantiaSchema` de lib/forms/validation-locacao.ts — é de lá que o
// fato chega (dataJson.garantia.tipo).
export const GARANTIA_LABELS: Record<GarantiaTipo, string> = {
  fiador: "Fiador",
  caucao: "Caução",
  seguro_fianca: "Seguro fiança",
  garantia_digital: "Garantia digital",
  titulo_capitalizacao: "Título de capitalização",
  propria: "Garantia própria",
  sem_garantia: "Sem garantia",
};

export type PessoaTipo = "pf" | "pj";
export const PESSOA_LABELS: Record<PessoaTipo, string> = {
  pf: "Pessoa física",
  pj: "Pessoa jurídica",
};

/**
 * Critério persistido no template. Extensível: campo novo = chave nova aqui, no
 * schema Zod, em `parseMatchCriteria` e na lista de campos do scoring.
 *
 * `pessoa` é o LOCATÁRIO/PROPONENTE; `fiadorPessoa` é o FIADOR — eixos
 * independentes, senão "PF com fiador PJ" não seria expressável.
 */
export interface TemplateMatchCriteria {
  garantia?: GarantiaTipo;
  fiadorPessoa?: PessoaTipo;
  pessoa?: PessoaTipo;
  /**
   * O imóvel é administrado pela imobiliária? Espelha `aluguel.adm_imobiliaria`
   * do formulário. Nome com `adm` (e não `administracao`) de propósito: neste
   * mesmo módulo `administracao_locacao` é uma MODALIDADE — outro tipo de
   * contrato, entre imobiliária e proprietário — e confundir os dois num
   * arquivo que decide qual contrato o cliente assina sairia caro.
   */
  admImobiliaria?: boolean;
}

/** Fatos lidos do form/proposta. `null` = não dá pra saber. */
export interface TemplateFacts {
  garantia: GarantiaTipo | null;
  fiadorPessoa: PessoaTipo | null;
  pessoa: PessoaTipo | null;
  admImobiliaria: boolean | null;
}

/** Campos comparáveis critério × fato. Adicionar campo novo passa por aqui. */
const MATCH_FIELDS = [
  "garantia",
  "fiadorPessoa",
  "pessoa",
  "admImobiliaria",
] as const;

/**
 * `<select>` de HTML só produz string, e este schema é a fronteira de TRÊS
 * rotas (`/templates`, `/templates/[id]`, `/templates/from-docx`). Coagir aqui
 * — em vez de em cada call-site — mantém `.strict()` e `z.boolean()` intactos
 * e impede que um `"false"` (string, truthy!) vire `true` em algum caminho
 * esquecido. Só as duas strings canônicas passam; qualquer outra coisa segue
 * pro `z.boolean()` e é rejeitada.
 */
const booleanFromForm = z.preprocess(
  (v) => (v === "true" ? true : v === "false" ? false : v),
  z.boolean().nullish()
);

export const matchCriteriaSchema = z
  .object({
    garantia: z.enum(GARANTIA_TIPOS).nullish(),
    fiadorPessoa: z.enum(["pf", "pj"]).nullish(),
    pessoa: z.enum(["pf", "pj"]).nullish(),
    admImobiliaria: booleanFromForm,
  })
  .strict()
  .nullish();

/**
 * Normaliza o Json cru do banco/payload em critério tipado. Chave desconhecida
 * ou valor fora do enum é DESCARTADO (não desclassifica nada) e critério vazio
 * volta como `null` — um template com `{}` é genérico, não "impossível".
 */
export function parseMatchCriteria(raw: unknown): TemplateMatchCriteria | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const out: TemplateMatchCriteria = {};
  if ((GARANTIA_TIPOS as readonly string[]).includes(obj.garantia as string)) {
    out.garantia = obj.garantia as GarantiaTipo;
  }
  if (obj.fiadorPessoa === "pf" || obj.fiadorPessoa === "pj") {
    out.fiadorPessoa = obj.fiadorPessoa;
  }
  if (obj.pessoa === "pf" || obj.pessoa === "pj") out.pessoa = obj.pessoa;
  // `typeof === "boolean"` e não truthiness: `false` é um critério LEGÍTIMO
  // ("este modelo é pra imóvel SEM administração"), não ausência de critério.
  if (typeof obj.admImobiliaria === "boolean") {
    out.admImobiliaria = obj.admImobiliaria;
  }
  return Object.keys(out).length ? out : null;
}

/** Rótulos dos critérios pra badge na UI (vazio = template genérico). */
export function matchCriteriaSummary(raw: unknown): string[] {
  const c = parseMatchCriteria(raw);
  if (!c) return [];
  const out: string[] = [];
  if (c.garantia) out.push(GARANTIA_LABELS[c.garantia]);
  if (c.fiadorPessoa) out.push(`Fiador ${c.fiadorPessoa.toUpperCase()}`);
  if (c.pessoa) out.push(PESSOA_LABELS[c.pessoa]);
  // Os DOIS valores viram badge: omitir o `false` faria a etiqueta declarar
  // menos do que o template de fato exige.
  if (c.admImobiliaria === true) out.push("Com administração");
  if (c.admImobiliaria === false) out.push("Sem administração");
  return out;
}

function pessoaFromParte(parte: unknown): PessoaTipo | null {
  if (!parte || typeof parte !== "object") return null;
  const p = parte as Record<string, unknown>;
  const nonEmpty = (v: unknown) => typeof v === "string" && v.trim().length > 0;
  if (p.tipo_pessoa === "juridica" || nonEmpty(p.cnpj)) return "pj";
  if (p.tipo_pessoa === "fisica" || nonEmpty(p.cpf)) return "pf";
  return null;
}

/**
 * Fatos do form de locação / da proposta.
 *
 * - `garantia` ← `dataJson.garantia.tipo` (enum do garantiaSchema).
 * - `fiadorPessoa` ← `dataJson.garantia.fiador.tipo_pessoa`, só quando a
 *   garantia É fiador (sem fiador o fato é desconhecido, não "PF").
 * - `pessoa` ← natureza do LOCATÁRIO/PROPONENTE: "pj" se QUALQUER um for
 *   jurídica, senão "pf". `tipo_pessoa` é o sinal canônico (discriminated union
 *   do form); CPF/CNPJ preenchido é fallback.
 *
 * A página de proposta (`/pipeline/propostas/nova` e `/[id]/editar`) coleta
 * `tipo_pessoa` por parte e, em locação, `garantia.tipo` (+ fiador PF/PJ) —
 * `buildProposalDataJson` em lib/proposals/form-data.ts escreve exatamente as
 * chaves lidas aqui, então a seleção de variante vale também pra proposta.
 * Propostas ANTIGAS (criadas antes disso, partes só com `{ nome }`) seguem com
 * fatos nulos e caem no `isDefault` — comportamento de antes, sem regressão.
 */
export function deriveTemplateFacts(dataJson: unknown): TemplateFacts {
  const data = (dataJson && typeof dataJson === "object" ? dataJson : {}) as Record<
    string,
    unknown
  >;

  const garantiaObj = data.garantia as { tipo?: unknown; fiador?: unknown } | undefined;
  const garantia = (GARANTIA_TIPOS as readonly string[]).includes(garantiaObj?.tipo as string)
    ? (garantiaObj!.tipo as GarantiaTipo)
    : null;
  const fiadorPessoa = garantia === "fiador" ? pessoaFromParte(garantiaObj?.fiador) : null;

  // `locatarios` (locação) e `compradores` (proposta de compra — ali o
  // proponente é o comprador). O papel proprietário/locador não entra: a
  // variante de template é do lado que contrata.
  const parties = [
    ...(Array.isArray(data.locatarios) ? data.locatarios : []),
    ...(Array.isArray(data.compradores) ? data.compradores : []),
  ];

  let pessoa: PessoaTipo | null = null;
  for (const p of parties) {
    const tipo = pessoaFromParte(p);
    if (tipo === "pj") {
      pessoa = "pj";
      break;
    }
    if (tipo === "pf") pessoa = "pf";
  }

  // Ausente ⇒ `null` (desconhecido), NUNCA `false`. Form antigo e proposta não
  // têm `aluguel`; mapear ausência pra "não tem administração" desclassificaria
  // (-1) todo modelo marcado como administração nesses fluxos, trocando um
  // template certo por outro sem que ninguém pedisse.
  const aluguel = data.aluguel as { adm_imobiliaria?: unknown } | undefined;
  const admImobiliaria =
    typeof aluguel?.adm_imobiliaria === "boolean" ? aluguel.adm_imobiliaria : null;

  return { garantia, fiadorPessoa, pessoa, admImobiliaria };
}

/**
 * Score puro do template contra os fatos:
 *   +1 por campo de critério que BATE com um fato conhecido;
 *   -1 (DESCLASSIFICADO) se qualquer campo contradiz um fato conhecido;
 *    0 pra template genérico (sem critério) — e também pro campo cujo fato é
 *      desconhecido, que não pontua nem desclassifica.
 */
export function scoreTemplateAgainstFacts(criteria: unknown, facts: TemplateFacts): number {
  const c = parseMatchCriteria(criteria);
  if (!c) return 0;
  let score = 0;
  for (const key of MATCH_FIELDS) {
    const wanted = c[key];
    // `== null` e não `!wanted`: com o eixo booleano, `false` é um critério
    // marcado ("modelo pra imóvel SEM administração"). Sob truthiness ele seria
    // ignorado, e o modelo de administração empataria com o comum em TODA
    // locação — o operador voltaria a escolher à mão, sem saber por quê.
    if (wanted == null) continue;
    const fact = facts[key];
    if (fact == null) continue;
    if (fact !== wanted) return -1;
    score += 1;
  }
  return score;
}

export interface TemplateCriteriaCandidate {
  isDefault: boolean;
  matchCriteria?: unknown;
}

/**
 * Escolhe entre candidatos JÁ filtrados por modalidade/status: maior score
 * vence, empate prefere `isDefault` (e depois a ordem recebida).
 *
 * Quando TODOS são desclassificados (a org marcou critérios e nenhum cobre este
 * form) NÃO devolvemos null: cai no comportamento pré-critério (isDefault da
 * modalidade). Falhar a geração com "nenhum template ativo" seria uma regressão
 * pra quem hoje recebe um contrato — o operador troca o template no editor.
 */
export function pickTemplateByFacts<T extends TemplateCriteriaCandidate>(
  candidates: T[],
  facts: TemplateFacts
): T {
  if (candidates.length === 0) {
    throw new Error("pickTemplateByFacts: lista de candidatos vazia");
  }
  const scored = candidates.map((c) => ({
    c,
    score: scoreTemplateAgainstFacts(c.matchCriteria, facts),
  }));
  const eligible = scored.filter((s) => s.score >= 0);
  const pool = eligible.length ? eligible : scored;
  const max = Math.max(...pool.map((s) => s.score));
  const top = pool.filter((s) => s.score === max).map((s) => s.c);
  return top.find((t) => t.isDefault) ?? top[0];
}

// ============================================================================
// Locação — seleção de template independente da heurística de pagamento de
// venda. O discriminador é o `schemaType` do form: residencial → modalidade
// "locacao"; comercial → "locacao_comercial" (modalidades distintas pra que o
// sync-templates não sobrescreva os dois arquivos). Preferimos isDefault.
// ============================================================================
export function modalidadeForLocacaoSchemaType(schemaType: string): string {
  return schemaType === "locacao_comercial_v1" ? "locacao_comercial" : "locacao";
}

export async function selectLocacaoTemplate(
  orgId: string,
  schemaType: string,
  dataJson?: unknown
): Promise<{ template: ContractTemplate } | null> {
  const modalidade = modalidadeForLocacaoSchemaType(schemaType);
  const { prisma } = await import("@/lib/db/prisma");
  const active = await prisma.contractTemplate.findMany({
    where: { orgId, status: "active" },
  });
  if (active.length === 0) return null;

  const facts = deriveTemplateFacts(dataJson);

  // 1) match exato da modalidade de locação. Dentro do conjunto, as ESCOLHAS DO
  //    FORM (garantia / fiador PF-PJ / locatário PF-PJ) desempatam variantes;
  //    sem variante marcada o resultado é o de sempre (isDefault, senão a 1ª).
  const exact = active.filter((t) => t.modalidade === modalidade);
  if (exact.length) return { template: pickTemplateByFacts(exact, facts) };

  // 2) fallback: qualquer template de locação ativo (modalidade começa com "locacao")
  const anyLocacao = active.filter((t) => (t.modalidade ?? "").startsWith("locacao"));
  if (anyLocacao.length) return { template: pickTemplateByFacts(anyLocacao, facts) };

  return null;
}

// ============================================================================
// Contrato de Administração de Locação (imobiliária ↔ proprietário).
// Modalidade "administracao_locacao" — nome deliberado que NÃO começa com
// "locacao" pra ficar fora do fallback startsWith acima. Match exato, SEM
// fallback: sem template ativo da modalidade, retorna null e o caller orienta a
// ativar um modelo em /templates (o canônico é semeado na criação do tenant por
// `seedCanonicalTemplatesForOrg`).
// ============================================================================
export const ADMINISTRACAO_LOCACAO_MODALIDADE = "administracao_locacao";

export async function selectAdministracaoTemplate(
  orgId: string
): Promise<{ template: ContractTemplate } | null> {
  const { prisma } = await import("@/lib/db/prisma");
  const exact = await prisma.contractTemplate.findMany({
    where: { orgId, status: "active", modalidade: ADMINISTRACAO_LOCACAO_MODALIDADE },
  });
  if (exact.length === 0) return null;
  return { template: exact.find((t) => t.isDefault) ?? exact[0] };
}

// ============================================================================
// FAMÍLIA do template (venda | locação | proposta).
//
// `category` é a forma de pagamento do negócio — existe SÓ no mundo de venda.
// Derivar `modalidade` da categoria fora de venda é destrutivo: um template de
// locação salvo pela tela de edição virava modalidade "a_vista" e sumia do
// selectLocacaoTemplate ("Nenhum template de locação ativo") e do catálogo de
// placeholders (que passava a oferecer campos de venda). A família é sempre
// lida da MODALIDADE persistida, nunca da categoria.
// ============================================================================
export const LOCACAO_MODALIDADES = [
  "locacao",
  "locacao_comercial",
  ADMINISTRACAO_LOCACAO_MODALIDADE,
] as const;
export type LocacaoModalidade = (typeof LOCACAO_MODALIDADES)[number];

export const VENDA_MODALIDADES = ["a_vista", "financiamento"] as const;

export type TemplateFamily = "venda" | "locacao" | "proposta";

export function templateFamilyForModalidade(
  modalidade: string | null | undefined
): TemplateFamily {
  const m = modalidade ?? "";
  if (m.startsWith("proposta_")) return "proposta";
  if ((LOCACAO_MODALIDADES as readonly string[]).includes(m)) return "locacao";
  return "venda";
}

export const MODALIDADE_LABELS: Record<string, string> = {
  a_vista: "Venda à vista",
  financiamento: "Venda com financiamento",
  locacao: "Locação residencial",
  locacao_comercial: "Locação comercial",
  administracao_locacao: "Administração de locação",
  proposta_venda: "Proposta de compra",
  proposta_locacao_residencial: "Proposta de locação residencial",
  proposta_locacao_comercial: "Proposta de locação comercial",
};

export function modalidadeLabel(modalidade: string | null | undefined): string {
  if (!modalidade) return "—";
  return MODALIDADE_LABELS[modalidade] ?? modalidade;
}

export interface PreviewFixture {
  /** Modalidade cuja amostra alimenta o render (`getPreviewSampleData`). */
  value: string;
  label: string;
}

/**
 * Amostras oferecidas no preview de um template.
 *
 * VENDA é a única família com duas: o mesmo texto-base costuma cobrir à vista e
 * financiamento, e alternar entre as amostras é como se testa
 * `{{#if pagamento.alienacao_fiduciaria}}` e afins. Locação, administração e
 * proposta têm schema próprio por modalidade — oferecer a amostra de outra
 * modalidade ali só renderiza um documento vazio. Por isso a lista tem UM item,
 * e a UI esconde as abas quando não há escolha a fazer.
 *
 * Era hardcode "À Vista | Financiamento" no diálogo: template de proposta ou de
 * locação mostrava as abas de venda e o preview saía com as chaves erradas.
 */
export function previewFixturesForModalidade(
  modalidade: string | null | undefined
): PreviewFixture[] {
  if (templateFamilyForModalidade(modalidade) === "venda") {
    return VENDA_MODALIDADES.map((m) => ({ value: m, label: modalidadeLabel(m) }));
  }
  const m = modalidade ?? "";
  return [{ value: m, label: modalidadeLabel(m) }];
}

/**
 * schemaType coerente com a modalidade — usado na ingestão (from-docx) e ao
 * corrigir a modalidade de um template já criado, pra os dois não divergirem.
 */
export const SCHEMA_TYPE_BY_MODALIDADE: Record<string, string> = {
  a_vista: "compra_venda_v2",
  financiamento: "compra_venda_v2",
  locacao: "locacao_residencial_v1",
  locacao_comercial: "locacao_comercial_v1",
  administracao_locacao: "administracao_locacao_v1",
  proposta_venda: "compra_venda_v1",
  proposta_locacao_residencial: "locacao_residencial_v1",
  proposta_locacao_comercial: "locacao_comercial_v1",
};

export function schemaTypeForModalidade(modalidade: string | null | undefined): string {
  return SCHEMA_TYPE_BY_MODALIDADE[modalidade ?? ""] ?? "compra_venda_v2";
}

/**
 * Modalidades oferecidas na ingestão "modelo da imobiliária (.docx) → template"
 * — na ordem em que aparecem no diálogo. Fonte única do <select> e da validação
 * do POST /api/templates/from-docx.
 */
export const UPLOAD_MODALIDADES = [
  "locacao",
  "locacao_comercial",
  "administracao_locacao",
  "a_vista",
  "financiamento",
] as const;

export function isKnownModalidade(v: unknown): v is string {
  return (
    typeof v === "string" &&
    ((VENDA_MODALIDADES as readonly string[]).includes(v) ||
      (LOCACAO_MODALIDADES as readonly string[]).includes(v) ||
      v.startsWith("proposta_"))
  );
}

/**
 * Resolve (category, modalidade) de uma ESCRITA de template.
 *
 * 1. `modalidade` explícita e conhecida sempre vence — é como o operador move
 *    um template entre famílias (e conserta um que foi salvo na errada).
 * 2. Senão, `category` só deriva a modalidade se o template JÁ é de venda.
 *    Este é o guard do bug: a tela de edição manda `category` mesmo pra um
 *    template de locação, e derivar dali virava "a_vista" — o template sumia
 *    do selectLocacaoTemplate e do catálogo de placeholders de locação.
 * 3. `category` só é persistida em template de venda; fora dela é null (não
 *    existe forma de pagamento em locação/proposta e a categoria residual
 *    puxaria o template pro resolver de venda).
 */
export function resolveTemplateTaxonomy(input: {
  currentModalidade: string | null;
  currentCategory: string | null;
  category?: unknown;
  modalidade?: unknown;
}): { category: string | null; modalidade: string | null } {
  const currentFamily = templateFamilyForModalidade(input.currentModalidade);
  const explicit = isKnownModalidade(input.modalidade) ? input.modalidade : null;

  const modalidade =
    explicit ??
    (currentFamily === "venda" && isTemplateCategory(input.category)
      ? modalidadeForCategory(input.category)
      : input.currentModalidade);

  if (templateFamilyForModalidade(modalidade) !== "venda") {
    return { category: null, modalidade };
  }
  return {
    category: isTemplateCategory(input.category) ? input.category : input.currentCategory,
    modalidade,
  };
}
