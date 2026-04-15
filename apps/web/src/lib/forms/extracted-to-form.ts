import type { UseFormReturn } from "react-hook-form";

export type DocumentKind = "vendedor" | "comprador" | "imovel" | "outro";

export interface ExtractedDoc {
  category: string | null;
  fields: Record<string, unknown>;
  confidence?: number;
}

export interface Assignment {
  kind: DocumentKind;
  index: number;
}

const PERSON_CATEGORIES = new Set([
  "rg",
  "cpf",
  "cnh",
  "procuracao",
  "comprovante_residencia",
  "certidao_casamento",
]);
const PROPERTY_CATEGORIES = new Set(["matricula", "iptu", "escritura"]);

// Maps the free-text "regime de bens" string extracted from a marriage
// certificate to the estado civil dropdown value used by the form. Accepts
// "Comunhao parcial", "Comunhao universal", "Separacao total", etc.
function inferEstadoCivilFromRegime(regime: unknown): string | null {
  if (typeof regime !== "string" || !regime.trim()) return null;
  // Anything that mentions "comunhao" or "separacao de bens" implies married
  const lower = regime
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (
    lower.includes("comunhao") ||
    lower.includes("separacao de bens") ||
    lower.includes("separacao total") ||
    lower.includes("separacao parcial") ||
    lower.includes("participacao final")
  ) {
    return "Casado(a)";
  }
  return null;
}

const FIELD_MAP_PERSON: Record<string, string> = {
  nome_completo: "nome",
  titular_nome: "nome",
  rg_numero: "rg",
  cpf_numero: "cpf",
  data_nascimento: "data_nascimento",
  naturalidade: "naturalidade",
  filiacao_mae: "filiacao_mae",
  filiacao_pai: "filiacao_pai",
  bairro: "bairro",
  cidade: "cidade",
  uf: "uf",
  cep: "cep",
};

const FIELD_MAP_IMOVEL: Record<string, string> = {
  matricula_numero: "matricula",
  cartorio: "cartorio",
  bairro: "bairro",
  cidade: "cidade",
  uf: "uf",
  cep: "cep",
  descricao_imovel: "descricao",
  inscricao_iptu: "inscricao_iptu",
  sql: "sql",
  inscricao_municipal: "inscricao_municipal",
  area_total: "area_total",
};

function onlyDigits(s: unknown): string {
  return typeof s === "string" ? s.replace(/\D/g, "") : "";
}

function sanitizeCpf(s: unknown): string | null {
  const d = onlyDigits(s);
  return d.length === 11 ? d : null;
}

function sanitizeUf(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const upper = s.trim().toUpperCase().slice(0, 2);
  return /^[A-Z]{2}$/.test(upper) ? upper : null;
}

function parseEndereco(value: unknown): { rua?: string; numero?: string } {
  if (typeof value !== "string" || !value.trim()) return {};
  const match = value.match(/^(.+?),?\s*(\d+[A-Za-z]?)(?:\s*[-,]\s*(.*))?$/);
  if (match) {
    return { rua: match[1].trim(), numero: match[2].trim() };
  }
  return { rua: value.trim() };
}

function coerce(field: string, value: unknown): unknown {
  if (value === null || value === undefined || value === "") return undefined;
  if (field === "cpf") return sanitizeCpf(value);
  if (field === "uf") return sanitizeUf(value);
  if (field === "rg") return typeof value === "string" ? value.trim() : undefined;
  return typeof value === "string" ? value.trim() : value;
}

export function mapExtractedToForm(
  extraction: ExtractedDoc,
  assignment: Assignment,
  form: UseFormReturn<Record<string, unknown>>,
  options: { skipIfDirty?: boolean } = {}
): number {
  const { skipIfDirty = true } = options;
  const { category, fields } = extraction;
  if (!category || !fields) return 0;

  const basePath =
    assignment.kind === "vendedor"
      ? `vendedores.${assignment.index}`
      : assignment.kind === "comprador"
      ? `compradores.${assignment.index}`
      : assignment.kind === "imovel"
      ? `imoveis.${assignment.index}`
      : null;
  if (!basePath) return 0;

  const isPerson = PERSON_CATEGORIES.has(category);
  const isProperty = PROPERTY_CATEGORIES.has(category);
  let filled = 0;

  const applyField = (formField: string, raw: unknown) => {
    const value = coerce(formField, raw);
    if (value === undefined || value === null || value === "") return;
    const fullPath = `${basePath}.${formField}`;
    if (skipIfDirty) {
      const current = form.getValues(fullPath);
      if (current !== undefined && current !== null && current !== "") return;
    }
    form.setValue(fullPath, value as never, { shouldDirty: true, shouldTouch: true });
    filled += 1;
  };

  if (isPerson) {
    for (const [ocrKey, formField] of Object.entries(FIELD_MAP_PERSON)) {
      if (ocrKey in fields) applyField(formField, fields[ocrKey]);
    }
    const enderecoRaw = fields.endereco_completo ?? fields.endereco;
    if (enderecoRaw) {
      const parsed = parseEndereco(enderecoRaw);
      if (parsed.rua) applyField("endereco", parsed.rua);
      if (parsed.numero) applyField("numero", parsed.numero);
    }

    // Marriage certificate — infer estado civil + conjuge from regime + 2nd spouse
    if (category === "certidao_casamento") {
      const regime = fields.regime_bens;
      const estadoCivil = inferEstadoCivilFromRegime(regime);
      if (estadoCivil) applyField("estado_civil", estadoCivil);

      // The primary person on this form slot is conjuge1; conjuge2 becomes
      // the "conjuge" sub-object. We only fill if the slot's conjuge is empty.
      const conjuge2Nome = fields.conjuge2_nome;
      const conjuge2Cpf = sanitizeCpf(fields.conjuge2_cpf);
      if (conjuge2Nome && typeof conjuge2Nome === "string") {
        const curr = form.getValues(`${basePath}.conjuge.nome`);
        if (!curr) {
          form.setValue(
            `${basePath}.conjuge.nome`,
            conjuge2Nome.trim() as never,
            { shouldDirty: true, shouldTouch: true }
          );
          filled += 1;
        }
      }
      if (conjuge2Cpf) {
        const curr = form.getValues(`${basePath}.conjuge.cpf`);
        if (!curr) {
          form.setValue(`${basePath}.conjuge.cpf`, conjuge2Cpf as never, {
            shouldDirty: true,
            shouldTouch: true,
          });
          filled += 1;
        }
      }
    }
  }

  if (isProperty) {
    for (const [ocrKey, formField] of Object.entries(FIELD_MAP_IMOVEL)) {
      if (ocrKey in fields) applyField(formField, fields[ocrKey]);
    }

    const enderecoRaw = fields.endereco_completo ?? fields.endereco;
    const parsed = parseEndereco(enderecoRaw);
    if (parsed.rua) applyField("rua", parsed.rua);
    if (parsed.numero) applyField("numero", parsed.numero);
  }

  return filled;
}

interface FormSnapshot {
  vendedores?: Array<Record<string, unknown>>;
  compradores?: Array<Record<string, unknown>>;
  imoveis?: Array<Record<string, unknown>>;
}

/**
 * A sibling document already processed in the same form session. When
 * suggesting an assignment for a new person doc, the UI looks at these
 * siblings to distinguish "same person" (same CPF → same slot) from
 * "different person" (different CPF → next slot or the comprador list).
 */
export interface ProcessedDocHint {
  category: string | null;
  fields: Record<string, unknown> | null;
  assignment: Assignment;
}

function firstEmptyIndex(list: Array<Record<string, unknown>> | undefined): number {
  if (!list || list.length === 0) return 0;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (!p?.nome && !p?.cpf && !p?.rg) return i;
  }
  return 0;
}

function matchPersonIndex(
  list: Array<Record<string, unknown>> | undefined,
  fields: Record<string, unknown>
): number | null {
  if (!list) return null;
  const extractedCpf = sanitizeCpf(fields.cpf_numero);
  const extractedNome =
    typeof fields.nome_completo === "string"
      ? fields.nome_completo.trim().toLowerCase()
      : null;
  for (let i = 0; i < list.length; i++) {
    const p = list[i] || {};
    const pCpf = sanitizeCpf(p.cpf);
    if (extractedCpf && pCpf && extractedCpf === pCpf) return i;
    if (extractedNome && typeof p.nome === "string") {
      if (p.nome.trim().toLowerCase() === extractedNome) return i;
    }
  }
  return null;
}

function personKey(fields: Record<string, unknown>): string | null {
  const cpf = sanitizeCpf(fields.cpf_numero);
  if (cpf) return `cpf:${cpf}`;
  const nome =
    typeof fields.nome_completo === "string"
      ? fields.nome_completo.trim().toLowerCase()
      : null;
  if (nome) return `nome:${nome}`;
  return null;
}

/**
 * Picks the assignment for a new person document using:
 *   1. form snapshot matching (if the user already typed a CPF/name)
 *   2. sibling hints — docs already processed in this session. If any
 *      sibling is assigned to vendedor[0] with a DIFFERENT identity,
 *      the new doc goes to comprador[0]. Same identity sticks together.
 *   3. default: vendedor[0] (first person doc wins the vendedor slot).
 */
function suggestPersonAssignment(
  fields: Record<string, unknown>,
  snapshot: FormSnapshot,
  siblings: ProcessedDocHint[]
): Assignment {
  // 1. Match against form-filled data first
  const vendedorMatch = matchPersonIndex(snapshot.vendedores, fields);
  if (vendedorMatch !== null) return { kind: "vendedor", index: vendedorMatch };
  const compradorMatch = matchPersonIndex(snapshot.compradores, fields);
  if (compradorMatch !== null) return { kind: "comprador", index: compradorMatch };

  // 2. Sibling identity matching — look for a doc with the same CPF/name
  const myKey = personKey(fields);
  if (myKey) {
    for (const sib of siblings) {
      if (!sib.fields) continue;
      if (!sib.category || !PERSON_CATEGORIES.has(sib.category)) continue;
      const sibKey = personKey(sib.fields);
      if (sibKey === myKey) {
        return sib.assignment;
      }
    }
  }

  // 3. Figure out which slots are already occupied by siblings
  const occupiedSlots = new Set<string>();
  const personSiblings = siblings.filter(
    (s) => s.category && PERSON_CATEGORIES.has(s.category) && s.fields
  );
  for (const sib of personSiblings) {
    occupiedSlots.add(`${sib.assignment.kind}:${sib.assignment.index}`);
  }

  // Default: if vendedor[0] is free, go there. Otherwise go to comprador[0]
  // (distinct CPF scenario — user uploaded docs for both seller and buyer).
  if (!occupiedSlots.has("vendedor:0")) {
    return { kind: "vendedor", index: firstEmptyIndex(snapshot.vendedores) };
  }
  if (!occupiedSlots.has("comprador:0")) {
    return { kind: "comprador", index: firstEmptyIndex(snapshot.compradores) };
  }
  // Both taken — fall back to vendedor's next empty slot
  return { kind: "vendedor", index: firstEmptyIndex(snapshot.vendedores) };
}

export function suggestAssignment(
  category: string | null,
  fields: Record<string, unknown>,
  snapshot: FormSnapshot,
  siblings: ProcessedDocHint[] = []
): Assignment {
  if (!category) return { kind: "outro", index: 0 };

  if (PROPERTY_CATEGORIES.has(category)) {
    return { kind: "imovel", index: 0 };
  }

  if (PERSON_CATEGORIES.has(category)) {
    return suggestPersonAssignment(fields, snapshot, siblings);
  }

  return { kind: "outro", index: 0 };
}

export function categoryLabel(category: string | null): string {
  switch (category) {
    case "rg":
      return "RG";
    case "cpf":
      return "CPF";
    case "cnh":
      return "CNH";
    case "matricula":
      return "Matrícula";
    case "iptu":
      return "IPTU";
    case "escritura":
      return "Escritura";
    case "procuracao":
      return "Procuração";
    case "comprovante_residencia":
      return "Comp. Residência";
    case "certidao_casamento":
      return "Certidão de Casamento";
    case "outro":
      return "Outro";
    default:
      return "—";
  }
}
