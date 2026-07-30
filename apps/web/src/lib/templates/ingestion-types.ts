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
export type CriteriaField = "garantia" | "fiadorPessoa" | "pessoa";

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
    criteria: ["garantia", "fiadorPessoa", "pessoa"],
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
 * Palavras-chave que identificam a família do documento. Testadas na ordem: o
 * contrato de administração cita "locação" o tempo todo, então vem antes; a
 * proposta cita "compra e venda", então "proposta" vem antes do CCV.
 */
function familyFromText(text: string): {
  type: IngestDocType;
  subOption?: string;
} {
  const head = text.slice(0, 4000).toLowerCase();
  const all = text.toLowerCase();
  const has = (re: RegExp) => re.test(head) || re.test(all.slice(0, 20_000));

  const isProposta = /\bproposta\b/.test(head);
  const isAdministracao =
    /contrato de administra|administra[çc][ãa]o de loca|presta[çc][ãa]o de servi[çc]os de administra/.test(
      head
    );
  const isLocacao = /loca[çc][ãa]o|locat[áa]ri|locador/.test(head);
  const isComercial = /n[ãa]o residencial|comercial/.test(head);

  if (isAdministracao) return { type: "contrato_administracao" };
  if (isProposta && isLocacao) {
    return {
      type: "proposta_locacao",
      subOption: isComercial ? "comercial" : "residencial",
    };
  }
  if (isProposta) return { type: "proposta_venda" };
  if (isLocacao) {
    return {
      type: "contrato_locacao",
      subOption: isComercial ? "comercial" : "residencial",
    };
  }
  const financiado = has(
    /financiamento|aliena[çc][ãa]o fiduci[áa]ri|carta de cr[ée]dito|consórcio|cons[óo]rcio|fgts/
  );
  return {
    type: "contrato_venda",
    subOption: financiado ? "financiamento" : "a_vista",
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
  const fam = familyFromText(`${input.filename}\n${input.text}`);
  const def = ingestDocTypeDef(fam.type);
  const sub = fam.subOption
    ? def.subOptions.find((o) => o.value === fam.subOption)?.label
    : null;
  return {
    ...fam,
    reason: `Estrutura de contrato completo; o texto indica ${def.label.replace(/^Modelo de /, "")}${
      sub ? ` (${sub.toLowerCase()})` : ""
    }.`,
  };
}
