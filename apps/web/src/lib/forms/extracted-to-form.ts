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
]);
const PROPERTY_CATEGORIES = new Set(["matricula", "iptu", "escritura"]);

const FIELD_MAP_PERSON: Record<string, string> = {
  nome_completo: "nome",
  titular_nome: "nome",
  rg_numero: "rg",
  cpf_numero: "cpf",
  naturalidade: "naturalidade",
  data_nascimento: "data_nascimento",
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

export function suggestAssignment(
  category: string | null,
  fields: Record<string, unknown>,
  snapshot: FormSnapshot
): Assignment {
  if (!category) return { kind: "outro", index: 0 };

  if (PROPERTY_CATEGORIES.has(category)) {
    return { kind: "imovel", index: 0 };
  }

  if (PERSON_CATEGORIES.has(category)) {
    const vendedorMatch = matchPersonIndex(snapshot.vendedores, fields);
    if (vendedorMatch !== null) return { kind: "vendedor", index: vendedorMatch };
    const compradorMatch = matchPersonIndex(snapshot.compradores, fields);
    if (compradorMatch !== null) return { kind: "comprador", index: compradorMatch };

    const hasVendedores = (snapshot.vendedores?.length ?? 0) > 0;
    const hasCompradores = (snapshot.compradores?.length ?? 0) > 0;
    if (hasVendedores && !hasCompradores) {
      return { kind: "vendedor", index: firstEmptyIndex(snapshot.vendedores) };
    }
    if (hasCompradores && !hasVendedores) {
      return { kind: "comprador", index: firstEmptyIndex(snapshot.compradores) };
    }
    return { kind: "vendedor", index: firstEmptyIndex(snapshot.vendedores) };
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
    case "outro":
      return "Outro";
    default:
      return "—";
  }
}
