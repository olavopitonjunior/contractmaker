/**
 * Field schemas para scoring per-campo após OCR via classifyAndExtract.
 *
 * classifyAndExtract retorna confidence GLOBAL (single number for the whole
 * document). Newton precisa de confidence POR CAMPO pra decidir o que pode
 * gravar direto vs. o que precisa pedir confirmação ao humano (ver
 * agents/newton/persona/OCR.md no repo openclaw).
 *
 * Estes schemas adicionam:
 *   - regex de validação por campo (CPF 11 dígitos, datas ISO, etc.)
 *   - lista de campos required vs. optional
 *   - função scoreFields() que combina presença + regex match em score 0-1
 *
 * Suportamos os documentTypes que classifyAndExtract conhece:
 *   rg | cpf | cnh | matricula | iptu | escritura | procuracao |
 *   comprovante_residencia | certidao_casamento | ficha_resumo | outro
 */

export interface FieldSpec {
  key: string;
  required: boolean;
  /**
   * Regex que validates valor extraído. Se valor bate → confidence alta.
   * Se não bate mas valor existe → confidence média (Gemini extraiu algo, regex não confirma formato).
   */
  regex?: RegExp;
  /** Descrição humana do campo, usada em mensagens de erro/log. */
  description?: string;
  /**
   * Hint pra detectar valores parcialmente ilegíveis. Ex: CPF com `X`/`?` no
   * meio. Se hit, confidence cai pra 0.3 e needsReview vira true mesmo se regex
   * falhar não passa.
   */
  partialMarkers?: RegExp;
}

export interface DocumentSchema {
  documentType: string;
  fields: FieldSpec[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CPF_RAW = /^\d{11}$/;
const CNPJ_RAW = /^\d{14}$/;
const CEP_RAW = /^\d{5}-?\d{3}$/;
const UF = /^[A-Z]{2}$/;
const PARTIAL_HINT = /[?xX]{2,}|\[ileg[íi]vel\]|\[\?\]/;
const NONEMPTY_STRING = /\S/;

const RG_FIELDS: FieldSpec[] = [
  { key: "nome_completo", required: true, regex: NONEMPTY_STRING, partialMarkers: PARTIAL_HINT },
  { key: "rg_numero", required: true, regex: /\d/, partialMarkers: PARTIAL_HINT },
  { key: "orgao_expedidor", required: false, regex: NONEMPTY_STRING },
  { key: "data_nascimento", required: true, regex: ISO_DATE, partialMarkers: PARTIAL_HINT },
  { key: "naturalidade", required: false, regex: NONEMPTY_STRING },
  { key: "filiacao_mae", required: false, regex: NONEMPTY_STRING, partialMarkers: PARTIAL_HINT },
  { key: "filiacao_pai", required: false, regex: NONEMPTY_STRING, partialMarkers: PARTIAL_HINT },
  { key: "conjuge_nome", required: false, regex: NONEMPTY_STRING },
  { key: "conjuge_cpf", required: false, regex: CPF_RAW, partialMarkers: PARTIAL_HINT },
];

const CPF_FIELDS: FieldSpec[] = [
  { key: "nome_completo", required: true, regex: NONEMPTY_STRING, partialMarkers: PARTIAL_HINT },
  { key: "cpf_numero", required: true, regex: CPF_RAW, partialMarkers: PARTIAL_HINT },
  { key: "data_nascimento", required: false, regex: ISO_DATE, partialMarkers: PARTIAL_HINT },
  { key: "situacao_cadastral", required: false, regex: NONEMPTY_STRING },
];

const CNH_FIELDS: FieldSpec[] = [
  { key: "nome_completo", required: true, regex: NONEMPTY_STRING, partialMarkers: PARTIAL_HINT },
  { key: "cpf_numero", required: true, regex: CPF_RAW, partialMarkers: PARTIAL_HINT },
  { key: "rg_numero", required: false, regex: /\d/ },
  { key: "data_nascimento", required: true, regex: ISO_DATE, partialMarkers: PARTIAL_HINT },
  { key: "naturalidade", required: false, regex: NONEMPTY_STRING },
  { key: "filiacao_mae", required: false, regex: NONEMPTY_STRING, partialMarkers: PARTIAL_HINT },
  { key: "filiacao_pai", required: false, regex: NONEMPTY_STRING, partialMarkers: PARTIAL_HINT },
  { key: "categoria", required: false, regex: /^[A-E]{1,3}$/ },
  { key: "data_emissao", required: false, regex: ISO_DATE },
  { key: "data_validade", required: true, regex: ISO_DATE, partialMarkers: PARTIAL_HINT },
  { key: "registro_cnh", required: false, regex: /\d/ },
  { key: "conjuge_nome", required: false, regex: NONEMPTY_STRING },
  { key: "conjuge_cpf", required: false, regex: CPF_RAW, partialMarkers: PARTIAL_HINT },
];

const MATRICULA_FIELDS: FieldSpec[] = [
  { key: "matricula_numero", required: true, regex: NONEMPTY_STRING, partialMarkers: PARTIAL_HINT },
  { key: "cartorio", required: true, regex: NONEMPTY_STRING },
  { key: "endereco_completo", required: true, regex: NONEMPTY_STRING, partialMarkers: PARTIAL_HINT },
  { key: "bairro", required: false, regex: NONEMPTY_STRING },
  { key: "cidade", required: true, regex: NONEMPTY_STRING },
  { key: "uf", required: true, regex: UF },
  { key: "cep", required: false, regex: CEP_RAW },
  { key: "proprietario_nome", required: true, regex: NONEMPTY_STRING, partialMarkers: PARTIAL_HINT },
  { key: "area_total", required: false, regex: NONEMPTY_STRING },
  { key: "onus_existentes", required: false },
  { key: "descricao_imovel", required: false, regex: NONEMPTY_STRING },
];

const IPTU_FIELDS: FieldSpec[] = [
  { key: "inscricao_iptu", required: true, regex: NONEMPTY_STRING, partialMarkers: PARTIAL_HINT },
  { key: "endereco", required: true, regex: NONEMPTY_STRING },
  { key: "bairro", required: false, regex: NONEMPTY_STRING },
  { key: "cidade", required: true, regex: NONEMPTY_STRING },
  { key: "uf", required: true, regex: UF },
  { key: "valor_venal", required: false, regex: NONEMPTY_STRING },
  { key: "ano_referencia", required: false, regex: /^\d{4}$/ },
  { key: "debitos_pendentes", required: false },
];

const ESCRITURA_FIELDS: FieldSpec[] = [
  { key: "vendedor_nome", required: true, regex: NONEMPTY_STRING },
  { key: "comprador_nome", required: true, regex: NONEMPTY_STRING },
  { key: "valor_transacao", required: true, regex: NONEMPTY_STRING },
  { key: "data_lavratura", required: true, regex: ISO_DATE },
  { key: "cartorio", required: false, regex: NONEMPTY_STRING },
  { key: "endereco_imovel", required: false, regex: NONEMPTY_STRING },
  { key: "matricula_referenciada", required: false, regex: NONEMPTY_STRING },
];

const PROCURACAO_FIELDS: FieldSpec[] = [
  { key: "outorgante_nome", required: true, regex: NONEMPTY_STRING },
  { key: "outorgante_cpf", required: true, regex: CPF_RAW, partialMarkers: PARTIAL_HINT },
  { key: "outorgado_nome", required: true, regex: NONEMPTY_STRING },
  { key: "outorgado_cpf", required: true, regex: CPF_RAW, partialMarkers: PARTIAL_HINT },
  { key: "poderes_resumo", required: false, regex: NONEMPTY_STRING },
  { key: "data_lavratura", required: true, regex: ISO_DATE },
  { key: "prazo_validade", required: false, regex: NONEMPTY_STRING },
];

const COMPROVANTE_RESIDENCIA_FIELDS: FieldSpec[] = [
  { key: "titular_nome", required: true, regex: NONEMPTY_STRING, partialMarkers: PARTIAL_HINT },
  { key: "endereco_completo", required: true, regex: NONEMPTY_STRING, partialMarkers: PARTIAL_HINT },
  { key: "bairro", required: false, regex: NONEMPTY_STRING },
  { key: "cidade", required: true, regex: NONEMPTY_STRING },
  { key: "uf", required: true, regex: UF },
  { key: "cep", required: false, regex: CEP_RAW },
  { key: "emissor", required: false, regex: NONEMPTY_STRING },
];

const CERTIDAO_CASAMENTO_FIELDS: FieldSpec[] = [
  { key: "conjuge1_nome", required: true, regex: NONEMPTY_STRING, partialMarkers: PARTIAL_HINT },
  { key: "conjuge1_cpf", required: false, regex: CPF_RAW, partialMarkers: PARTIAL_HINT },
  { key: "conjuge2_nome", required: true, regex: NONEMPTY_STRING, partialMarkers: PARTIAL_HINT },
  { key: "conjuge2_cpf", required: false, regex: CPF_RAW, partialMarkers: PARTIAL_HINT },
  { key: "data_casamento", required: true, regex: ISO_DATE, partialMarkers: PARTIAL_HINT },
  { key: "regime_bens", required: true, regex: NONEMPTY_STRING },
  { key: "cartorio", required: false, regex: NONEMPTY_STRING },
  { key: "data_lavratura", required: false, regex: ISO_DATE },
];

export const SCHEMAS: Record<string, DocumentSchema> = {
  rg: { documentType: "rg", fields: RG_FIELDS },
  cpf: { documentType: "cpf", fields: CPF_FIELDS },
  cnh: { documentType: "cnh", fields: CNH_FIELDS },
  matricula: { documentType: "matricula", fields: MATRICULA_FIELDS },
  iptu: { documentType: "iptu", fields: IPTU_FIELDS },
  escritura: { documentType: "escritura", fields: ESCRITURA_FIELDS },
  procuracao: { documentType: "procuracao", fields: PROCURACAO_FIELDS },
  comprovante_residencia: { documentType: "comprovante_residencia", fields: COMPROVANTE_RESIDENCIA_FIELDS },
  certidao_casamento: { documentType: "certidao_casamento", fields: CERTIDAO_CASAMENTO_FIELDS },
};

export const NEEDS_REVIEW_THRESHOLD = 0.7;

export interface ScoredField {
  value: unknown;
  confidence: number;
  needsReview: boolean;
  reason?: string;
}

export type ScoredFields = Record<string, ScoredField>;

export interface ScoreResult {
  fields: ScoredFields;
  lowConfidenceFields: string[];
  /** Campos required que estão null/empty/missing — bloqueiam ações automáticas. */
  missingRequiredFields: string[];
  /** Campos extra que o modelo extraiu mas não estão no schema. Mantidos com confidence média. */
  unknownFields: string[];
}

function isEmptyValue(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

function asTestableString(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}

/**
 * Pontua um único campo segundo um FieldSpec.
 *
 * Lógica:
 *   - empty + required → 0.0, needsReview true, reason "missing"
 *   - empty + optional → 0.0, needsReview false (campo opcional ausente é OK)
 *   - partialMarkers hit → 0.3, needsReview true, reason "partial"
 *   - regex defined and matches → 0.95, needsReview false
 *   - regex defined but fails → 0.4, needsReview true, reason "format"
 *   - no regex, value present → 0.75, needsReview false
 */
export function scoreField(spec: FieldSpec, value: unknown): ScoredField {
  if (isEmptyValue(value)) {
    return {
      value: null,
      confidence: 0,
      needsReview: spec.required,
      reason: spec.required ? "missing" : undefined,
    };
  }
  const tested = asTestableString(value);
  if (spec.partialMarkers && tested && spec.partialMarkers.test(tested)) {
    return { value, confidence: 0.3, needsReview: true, reason: "partial" };
  }
  if (spec.regex) {
    if (tested && spec.regex.test(tested)) {
      return { value, confidence: 0.95, needsReview: false };
    }
    return { value, confidence: 0.4, needsReview: true, reason: "format" };
  }
  return { value, confidence: 0.75, needsReview: false };
}

/**
 * Pontua todos os campos de um documento.
 *
 * Aceita rawFields livres (vindo do Gemini OCR) e produz um mapa scored.
 * Campos do schema que não vieram no rawFields entram como missing. Campos
 * extras do rawFields (não previstos no schema) entram como unknown com
 * confidence 0.5.
 */
export function scoreFields(
  documentType: string,
  rawFields: Record<string, unknown>
): ScoreResult {
  const schema = SCHEMAS[documentType];
  const fields: ScoredFields = {};
  const lowConfidenceFields: string[] = [];
  const missingRequiredFields: string[] = [];
  const unknownFields: string[] = [];

  if (!schema) {
    for (const [key, value] of Object.entries(rawFields)) {
      const score: ScoredField = isEmptyValue(value)
        ? { value: null, confidence: 0, needsReview: false }
        : { value, confidence: 0.5, needsReview: true, reason: "no_schema" };
      fields[key] = score;
      if (score.needsReview) lowConfidenceFields.push(key);
    }
    return { fields, lowConfidenceFields, missingRequiredFields, unknownFields };
  }

  const knownKeys = new Set<string>();
  for (const spec of schema.fields) {
    knownKeys.add(spec.key);
    const scored = scoreField(spec, rawFields[spec.key]);
    fields[spec.key] = scored;
    if (scored.confidence < NEEDS_REVIEW_THRESHOLD && scored.needsReview) {
      lowConfidenceFields.push(spec.key);
    }
    if (spec.required && scored.confidence === 0) {
      missingRequiredFields.push(spec.key);
    }
  }

  for (const [key, value] of Object.entries(rawFields)) {
    if (knownKeys.has(key)) continue;
    unknownFields.push(key);
    fields[key] = isEmptyValue(value)
      ? { value: null, confidence: 0, needsReview: false }
      : { value, confidence: 0.5, needsReview: true, reason: "unknown_field" };
    if (!isEmptyValue(value)) lowConfidenceFields.push(key);
  }

  return { fields, lowConfidenceFields, missingRequiredFields, unknownFields };
}

export const SUPPORTED_DOCUMENT_TYPES = Object.keys(SCHEMAS) as Array<keyof typeof SCHEMAS>;
