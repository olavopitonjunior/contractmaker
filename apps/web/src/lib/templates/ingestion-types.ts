/**
 * Tipos de documento da CENTRAL DE INGESTÃO — na linguagem do usuário.
 *
 * A modalidade (`a_vista`, `proposta_locacao_residencial`…) é vocabulário do
 * sistema; a imobiliária pensa em "modelo de contrato de locação" e escolhe
 * "residencial ou comercial". Este módulo é a ponte: cada tipo tem a pergunta
 * como o usuário a faria, a descrição que o dono ditou, e a sub-opção que
 * resolve a modalidade. Fonte única do <select> da triagem E da validação da
 * rota de análise.
 *
 * Os EIXOS DE PAREAMENTO (`criteria`) usam as MESMAS opções e rótulos do
 * formulário (`GARANTIA_LABELS`, `PESSOA_LABELS` em template-category) — o
 * operador seleciona ali exatamente o que selecionaria no form, e o resultado é
 * gravado em `ContractTemplate.matchCriteria`. Zero interpretação.
 *
 * Client-safe: sem prisma, sem fs.
 */

import type { ModuleKey } from "@/lib/modules/catalog";
import type { ClauseSlotKey } from "./clause-slots";

export const INGEST_DOC_TYPES = [
  "proposta_locacao",
  "proposta_venda",
  "contrato_venda",
  "contrato_locacao",
  "contrato_administracao",
  "clausulas",
] as const;
export type IngestDocType = (typeof INGEST_DOC_TYPES)[number];

/** Eixo de `matchCriteria` oferecido na triagem. */
export type CriteriaField =
  | "garantia"
  | "fiadorPessoa"
  | "pessoa"
  | "admImobiliaria";

export interface IngestSubOption {
  value: string;
  label: string;
  /** Modalidade de `ContractTemplate` que esta escolha produz. */
  modalidade: string;
}

export interface IngestDocTypeDef {
  key: IngestDocType;
  /** Pergunta "Que documento é este?" — a resposta, como o usuário diria. */
  label: string;
  /** Descrição fixa, ditada pelo dono do produto. */
  description: string;
  /**
   * Módulo que precisa estar habilitado pro tipo aparecer. `null` = sempre
   * (cláusulas avulsas não pertencem a módulo nenhum).
   */
  module: ModuleKey | null;
  /** Rótulo da sub-pergunta (vazio quando não há sub-opção). */
  subLabel?: string;
  subOptions: IngestSubOption[];
  /** Modalidade quando o tipo não tem sub-opção. */
  modalidade?: string;
  criteria: CriteriaField[];
  /** Slots que a consolidação pode abrir neste tipo de documento. */
  slots: ClauseSlotKey[];
}

const LOCACAO_SUB: IngestSubOption[] = [
  { value: "residencial", label: "Residencial", modalidade: "locacao" },
  { value: "comercial", label: "Comercial", modalidade: "locacao_comercial" },
  { value: "temporada", label: "Por temporada (short stay)", modalidade: "temporada" },
];

const PROPOSTA_LOCACAO_SUB: IngestSubOption[] = [
  {
    value: "residencial",
    label: "Residencial",
    modalidade: "proposta_locacao_residencial",
  },
  {
    value: "comercial",
    label: "Comercial",
    modalidade: "proposta_locacao_comercial",
  },
];

// A sub-opção da venda espelha o form de pagamento — é a MESMA decisão que
// `deriveCategoryFromPayment` toma na geração, só que declarada na ingestão.
const VENDA_SUB: IngestSubOption[] = [
  { value: "a_vista", label: "À vista", modalidade: "a_vista" },
  { value: "financiamento", label: "Financiamento", modalidade: "financiamento" },
];

export const INGEST_DOC_TYPE_DEFS: IngestDocTypeDef[] = [
  {
    key: "contrato_locacao",
    label: "Modelo de contrato de locação",
    description:
      "O contrato que locador e locatário assinam. Residencial ou comercial — e a garantia (fiador, caução, seguro-fiança…) pode variar entre versões do mesmo modelo.",
    module: "locacao",
    subLabel: "Residencial ou comercial?",
    subOptions: LOCACAO_SUB,
    // `admImobiliaria` só no CONTRATO de locação: é lá que o texto muda (quem
    // recebe o aluguel, boleto da imobiliária × pagamento direto ao locador).
    // Na proposta o dado nem foi coletado ainda.
    criteria: ["garantia", "fiadorPessoa", "pessoa", "admImobiliaria"],
    slots: ["garantia"],
  },
  {
    key: "proposta_locacao",
    label: "Modelo de proposta de locação",
    description:
      "Não tem financiamento ou à vista; o que muda é a garantia (fiador PF, fiador PJ, sem fiador…).",
    module: "locacao",
    subLabel: "Residencial ou comercial?",
    subOptions: PROPOSTA_LOCACAO_SUB,
    criteria: ["garantia", "fiadorPessoa", "pessoa"],
    slots: ["garantia"],
  },
  {
    key: "contrato_administracao",
    label: "Modelo de contrato de administração",
    description:
      "O contrato entre a imobiliária e o proprietário, que autoriza vocês a administrar a locação.",
    module: "locacao",
    subOptions: [],
    modalidade: "administracao_locacao",
    criteria: [],
    slots: [],
  },
  {
    key: "contrato_venda",
    label: "Modelo de contrato de compra e venda",
    description:
      "O CCV que comprador e vendedor assinam. O que muda é a forma de pagamento.",
    module: "vendas",
    subLabel: "Forma de pagamento",
    subOptions: VENDA_SUB,
    criteria: [],
    slots: [],
  },
  {
    key: "proposta_venda",
    label: "Modelo de proposta de venda",
    description:
      "A oferta que o comprador assina antes do contrato, com valor, condições e prazo de validade.",
    module: "vendas",
    subOptions: [],
    modalidade: "proposta_venda",
    criteria: ["pessoa"],
    slots: [],
  },
  {
    key: "clausulas",
    label: "Cláusulas avulsas",
    description:
      "Não é um contrato inteiro: é um punhado de cláusulas para reusar. Vão para o acervo, separadas uma a uma, e a IA passa a consultá-las.",
    module: null,
    subOptions: [],
    criteria: [],
    slots: [],
  },
];

const DEF_BY_KEY = new Map(INGEST_DOC_TYPE_DEFS.map((d) => [d.key, d]));

export function ingestDocTypeDef(key: IngestDocType): IngestDocTypeDef {
  const def = DEF_BY_KEY.get(key);
  if (!def) throw new Error(`Tipo de documento desconhecido: ${key}`);
  return def;
}

export function isIngestDocType(v: unknown): v is IngestDocType {
  return typeof v === "string" && (INGEST_DOC_TYPES as readonly string[]).includes(v);
}

/**
 * Tipos oferecidos a uma org, filtrados pelos MÓDULOS habilitados — uma
 * imobiliária só-locação não deve nem enxergar "contrato de compra e venda".
 * "Cláusulas avulsas" (module null) aparece sempre.
 */
export function ingestDocTypesForModules(
  modules: readonly string[]
): IngestDocTypeDef[] {
  const set = new Set(modules);
  return INGEST_DOC_TYPE_DEFS.filter((d) => d.module === null || set.has(d.module));
}

/** Modalidade final: sub-opção escolhida, ou a modalidade fixa do tipo. */
export function modalidadeForIngest(
  key: IngestDocType,
  subOption?: string | null
): string | null {
  const def = ingestDocTypeDef(key);
  if (def.subOptions.length === 0) return def.modalidade ?? null;
  const hit = def.subOptions.find((o) => o.value === subOption);
  return (hit ?? def.subOptions[0]).modalidade;
}

// ────────────────────────────────────────────────────────────────────────────
// Palpite do tipo (determinístico, sem IA)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Quantas linhas com conteúdo formam o "título" do documento. `suggestDocType`
 * antepõe o NOME DO ARQUIVO ao texto, então a linha 1 é o nome e as seguintes
 * são o título/subtítulo do instrumento.
 */
const TITLE_LINES = 4;
const TITLE_CHARS = 400;

/**
 * Bloco de título: as primeiras linhas não-vazias, em minúsculas.
 *
 * Exportado porque é o coração do palpite — e porque o bug que ele conserta era
 * invisível: a heurística antiga usava os primeiros 4.000 CARACTERES como
 * proxy de título. Num contrato longo isso funciona por acidente (o corpo fica
 * fora da janela); num contrato CURTO a janela engole o documento inteiro e
 * qualquer menção de passagem a "proposta" no meio de uma cláusula ("conforme a
 * proposta de seguro", "protocolo da proposta") passava a decidir o tipo. Foi
 * assim que um "CONTRATO DE LOCAÇÃO RESIDENCIAL" de 8 cláusulas virou modelo de
 * PROPOSTA no QA — e nasceu na modalidade errada.
 */
export function documentTitleBlock(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, TITLE_LINES)
    .join("\n")
    .slice(0, TITLE_CHARS)
    .toLowerCase();
}

/** O instrumento é de administração — qualificador, vence a corrida abaixo. */
const RE_ADMINISTRACAO =
  /administra[çc][ãa]o|presta[çc][ãa]o de servi[çc]os de administrar/;
const RE_PROPOSTA = /\bpropostas?\b/;
/** Palavras que nomeiam um instrumento definitivo (não uma oferta). */
const RE_INSTRUMENTO =
  /\bcontratos?\b|\binstrumentos?\b|\bcompromissos?\b|\bescrituras?\b|\bminutas?\b|\btermos?\b/;
const RE_LOCACAO = /loca[çc][ãa]o|locat[áa]ri|locador|aluguel|inquilin/;
const RE_VENDA =
  /compra e venda|venda e compra|comprador|vendedor|\bccv\b|promessa de venda/;
const RE_COMERCIAL = /n[ãa]o[- ]residencial|comercial/;
const RE_FINANCIADO =
  /financiamento|aliena[çc][ãa]o fiduci[áa]ri|carta de cr[ée]dito|cons[óo]rcio|fgts/;

/**
 * Proposta DE VERDADE no corpo: a peça que se DECLARA proposta. Não casa a que
 * apenas cita uma ("proposta de seguro", "protocolo da proposta") — que é
 * exatamente o que um contrato de locação com seguro-fiança ou título de
 * capitalização faz, e o que quebrava o palpite.
 */
const RE_PROPOSTA_BODY =
  /\b(?:a\s+)?(?:presente|esta)\s+propostas?\b|\bpropostas?\s+de\s+(?:loca|compra|venda|aquisi)|\bproponente\b/;

/** Sinais de que o documento é o instrumento definitivo, não uma oferta. */
const RE_FECHO =
  /por\s+estarem\s+(?:assim\s+)?justos|firmam\s+o\s+presente|assinam\s+o\s+presente|em\s+\d+\s*\(?[a-zà-ú]*\)?\s*vias|^\s*testemunhas?\s*:?\s*$/im;
const RE_RESCISAO = /rescis[ãa]o|rescindir|resili[çc]/;
const RE_VIGENCIA = /prazo\s+de\s+\d+|vig[êe]ncia|prorroga/;

function firstIndex(re: RegExp, s: string): number {
  const m = re.exec(s);
  return m ? m.index : Number.POSITIVE_INFINITY;
}

function locacaoSubOption(scope: string): string {
  return RE_COMERCIAL.test(scope) ? "comercial" : "residencial";
}

/**
 * Família do documento. O TÍTULO manda; o corpo só decide quando o título não
 * nomeia o instrumento.
 *
 * Regra 1 — TÍTULO DOMINANTE. "CONTRATO DE LOCAÇÃO" é contrato, ponto final,
 * por mais vezes que a palavra "proposta" apareça nas cláusulas. Entre
 * "proposta" e "contrato" no mesmo título, vence QUEM APARECE PRIMEIRO — é como
 * se lê um título ("Contrato de locação … conforme proposta" é contrato).
 *
 * Regra 2 — DESEMPATE NO CORPO. Sem título conclusivo, um texto que parece
 * proposta ainda é tratado como CONTRATO quando tem fecho de assinaturas com
 * locador e locatário E cláusula de vigência ou rescisão: proposta é oferta,
 * não rescinde nem se assina em duas vias com testemunhas.
 */
function familyFromText(
  filename: string,
  text: string
): {
  type: IngestDocType;
  subOption?: string;
  via: "title" | "body";
} {
  const title = documentTitleBlock(`${filename}\n${text}`);
  const body = text.slice(0, 20_000).toLowerCase();
  const scope = `${title}\n${body}`;

  // ── Regra 1: título ──────────────────────────────────────────────────────
  if (RE_ADMINISTRACAO.test(title)) {
    return { type: "contrato_administracao", via: "title" };
  }

  const iProposta = firstIndex(RE_PROPOSTA, title);
  const iInstrumento = firstIndex(RE_INSTRUMENTO, title);
  const titleDecides = Number.isFinite(iProposta) || Number.isFinite(iInstrumento);

  if (titleDecides) {
    const isProposta = iProposta < iInstrumento;
    // A família (locação × venda) sai do título quando ele a nomeia; senão do
    // corpo — "PROPOSTA" sozinha no título não diz de quê.
    const isLocacao = RE_LOCACAO.test(title)
      ? true
      : RE_VENDA.test(title)
        ? false
        : RE_LOCACAO.test(body) && !RE_VENDA.test(body);

    if (isProposta) {
      return isLocacao
        ? {
            type: "proposta_locacao",
            subOption: locacaoSubOption(scope),
            via: "title",
          }
        : { type: "proposta_venda", via: "title" };
    }
    return isLocacao
      ? { type: "contrato_locacao", subOption: locacaoSubOption(scope), via: "title" }
      : {
          type: "contrato_venda",
          subOption: RE_FINANCIADO.test(scope) ? "financiamento" : "a_vista",
          via: "title",
        };
  }

  // ── Regra 2: corpo (título mudo) ─────────────────────────────────────────
  if (RE_ADMINISTRACAO.test(body)) {
    return { type: "contrato_administracao", via: "body" };
  }

  const isLocacao = RE_LOCACAO.test(scope);
  const parecerProposta = RE_PROPOSTA_BODY.test(scope);
  // Fecho de assinaturas das duas partes + vigência/rescisão = instrumento
  // definitivo. Proposta não rescinde.
  const pareceContrato =
    RE_FECHO.test(text) &&
    /locador/.test(scope) &&
    /locat[áa]ri/.test(scope) &&
    (RE_RESCISAO.test(scope) || RE_VIGENCIA.test(scope));

  if (parecerProposta && !pareceContrato) {
    return isLocacao
      ? { type: "proposta_locacao", subOption: locacaoSubOption(scope), via: "body" }
      : { type: "proposta_venda", via: "body" };
  }
  if (isLocacao) {
    return { type: "contrato_locacao", subOption: locacaoSubOption(scope), via: "body" };
  }
  return {
    type: "contrato_venda",
    subOption: RE_FINANCIADO.test(scope) ? "financiamento" : "a_vista",
    via: "body",
  };
}

export interface DocTypeSuggestion {
  type: IngestDocType;
  subOption?: string;
  /** Frase curta em PT-BR mostrada no card (o "porquê" do palpite). */
  reason: string;
}

/**
 * Palpite do tipo a partir da classificação estrutural (`upload-classifier`) e
 * de palavras-chave do texto. É só o DEFAULT do <select> — quem responde "que
 * documento é este?" é o usuário.
 */
export function suggestDocType(input: {
  classificationKind: "template" | "clauses" | "knowledge";
  classificationReason?: string;
  filename: string;
  text: string;
}): DocTypeSuggestion {
  if (input.classificationKind !== "template") {
    return {
      type: "clausulas",
      reason:
        input.classificationKind === "clauses"
          ? "Parece uma coleção de cláusulas soltas, não um contrato inteiro."
          : "Parece material de referência, não um contrato inteiro.",
    };
  }
  const fam = familyFromText(input.filename, input.text);
  const def = ingestDocTypeDef(fam.type);
  const sub = fam.subOption
    ? def.subOptions.find((o) => o.value === fam.subOption)?.label
    : null;
  const nome = `${def.label.replace(/^Modelo de /, "")}${
    sub ? ` (${sub.toLowerCase()})` : ""
  }`;
  return {
    type: fam.type,
    subOption: fam.subOption,
    // Dizer DE ONDE veio o palpite é o que permite ao operador discordar com
    // conhecimento de causa — "pelo título" é bem mais confiável que "pelo texto".
    reason:
      fam.via === "title"
        ? `Contrato completo; o título do documento diz ${nome}.`
        : `Contrato completo; o texto indica ${nome}.`,
  };
}
