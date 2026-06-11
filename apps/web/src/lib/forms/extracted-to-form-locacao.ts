import type { UseFormReturn } from "react-hook-form";
import {
  PERSON_CATEGORIES,
  PROPERTY_CATEGORIES,
  coerce,
  parseEndereco,
  sanitizeCpf,
  type Assignment,
  type DocumentKind,
  type ExtractedDoc,
  type ProcessedDocHint,
} from "./extracted-to-form";

/**
 * Mapeamento OCR → form de LOCAÇÃO (dadosLocacaoSchema). Espelha
 * extracted-to-form.ts (venda) trocando os basePaths: `locadores.{i}` /
 * `locatarios.{i}` / `garantia.fiador` (sem índice) / `imovel` (objeto
 * SINGULAR, sem índice). Reusa as categorias e helpers de sanitização de lá.
 *
 * Diferenças deliberadas vs venda:
 * - Partes de locação não têm subobjeto `conjuge` — os ramos de certidão de
 *   casamento/averbação não rodam.
 * - `ficha_resumo` declara papéis de venda (vendedor/comprador) — fora do
 *   escopo aqui; docs ficha caem em "outro".
 * - `area_total` do OCR vira `imovel.area` (number no schema de locação).
 */

const ADDRESS_FIELDS = new Set([
  "endereco",
  "numero",
  "complemento",
  "bairro",
  "cidade",
  "uf",
  "cep",
]);

// parteLocacaoSchema não tem naturalidade/sexo/nome_mae — mapeia só o que o
// schema conhece pra não injetar chaves órfãs no dataJson.
const FIELD_MAP_PERSON_LOCACAO: Record<string, string> = {
  nome_completo: "nome",
  titular_nome: "nome",
  rg_numero: "rg",
  cpf_numero: "cpf",
  data_nascimento: "data_nascimento",
  bairro: "bairro",
  cidade: "cidade",
  uf: "uf",
  cep: "cep",
};

const FIELD_MAP_IMOVEL_LOCACAO: Record<string, string> = {
  matricula_numero: "matricula",
  cartorio: "cartorio",
  bairro: "bairro",
  cidade: "cidade",
  uf: "uf",
  cep: "cep",
  descricao_imovel: "descricao",
  inscricao_iptu: "inscricao_iptu",
  area_total: "area",
};

export type LocacaoPartyKind =
  | "locador"
  | "locatario"
  | "fiador"
  | "representante_locador"
  | "representante_locatario";

/**
 * Resolve o basePath de aplicação dos campos pelo kind do doc. Fiador vive em
 * `garantia.fiador` (sem índice); imóvel é objeto singular.
 */
export function resolveLocacaoBasePath(assignment: Assignment): string | null {
  switch (assignment.kind) {
    case "locador":
      return `locadores.${assignment.index}`;
    case "locatario":
      return `locatarios.${assignment.index}`;
    case "fiador":
      return "garantia.fiador";
    case "representante_locador":
      return `locadores.${assignment.index}.representante`;
    case "representante_locatario":
      return `locatarios.${assignment.index}.representante`;
    case "imovel":
      return "imovel";
    default:
      return null;
  }
}

export function mapExtractedToLocacaoForm(
  extraction: ExtractedDoc,
  assignment: Assignment,
  form: UseFormReturn<Record<string, unknown>>,
  options: { skipIfDirty?: boolean; forceBasePath?: string } = {}
): number {
  const { skipIfDirty = true, forceBasePath } = options;
  const { category, fields } = extraction;
  if (!category || !fields) return 0;

  const basePath = forceBasePath ?? resolveLocacaoBasePath(assignment);
  if (!basePath) return 0;

  const isPerson = PERSON_CATEGORIES.has(category);
  const isProperty = PROPERTY_CATEGORIES.has(category);
  let filled = 0;

  const applyField = (formField: string, raw: unknown) => {
    let value = coerce(formField, raw);
    // `area` é number no schema de locação; OCR devolve string.
    if (formField === "area") {
      const n = Number(String(raw).replace(",", "."));
      value = Number.isFinite(n) && n > 0 ? n : undefined;
    }
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
    for (const [ocrKey, formField] of Object.entries(FIELD_MAP_PERSON_LOCACAO)) {
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
    for (const [ocrKey, formField] of Object.entries(FIELD_MAP_IMOVEL_LOCACAO)) {
      if (ocrKey in fields) applyField(formField, fields[ocrKey]);
    }
    const enderecoRaw = fields.endereco_completo ?? fields.endereco;
    const parsed = parseEndereco(enderecoRaw);
    if (parsed.rua) applyField("rua", parsed.rua);
    if (parsed.numero) applyField("numero", parsed.numero);
  }

  return filled;
}

export interface LocacaoFormSnapshot {
  locadores?: Array<Record<string, unknown>>;
  locatarios?: Array<Record<string, unknown>>;
  garantia?: { tipo?: string; fiador?: Record<string, unknown> };
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

function matchRepresentanteIndex(
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
    if (list[i]?.tipo_pessoa !== "juridica") continue;
    const r = (list[i]?.representante ?? {}) as Record<string, unknown>;
    const rCpf = sanitizeCpf(r.cpf);
    if (extractedCpf && rCpf && extractedCpf === rCpf) return i;
    if (
      extractedNome &&
      typeof r.nome === "string" &&
      r.nome.trim().toLowerCase() === extractedNome
    ) {
      return i;
    }
  }
  return null;
}

function matchFiador(
  garantia: LocacaoFormSnapshot["garantia"],
  fields: Record<string, unknown>
): boolean {
  const fiador = garantia?.fiador;
  if (!fiador) return false;
  const extractedCpf = sanitizeCpf(fields.cpf_numero);
  const extractedNome =
    typeof fields.nome_completo === "string"
      ? fields.nome_completo.trim().toLowerCase()
      : null;
  const fCpf = sanitizeCpf(fiador.cpf);
  if (extractedCpf && fCpf && extractedCpf === fCpf) return true;
  if (
    extractedNome &&
    typeof fiador.nome === "string" &&
    fiador.nome.trim().toLowerCase() === extractedNome
  ) {
    return true;
  }
  return false;
}

/**
 * Sugere o slot de um documento novo na etapa 0 de locação:
 *   1. doc de imóvel (matrícula/IPTU/escritura) → imovel
 *   2. match titular (CPF/nome) em locadores → locatarios
 *   3. match fiador (garantia.fiador)
 *   4. match representante de parte PJ
 *   5. sibling identity — mesma pessoa em outro doc desta sessão
 *   6. fallback "outro" — usuário escolhe no dropdown
 */
export function suggestLocacaoAssignment(
  category: string | null,
  fields: Record<string, unknown>,
  snapshot: LocacaoFormSnapshot,
  siblings: ProcessedDocHint[] = []
): Assignment {
  if (!category) return { kind: "outro", index: 0 };

  if (PROPERTY_CATEGORIES.has(category)) {
    return { kind: "imovel", index: 0 };
  }

  if (!PERSON_CATEGORIES.has(category)) {
    return { kind: "outro", index: 0 };
  }

  const locadorMatch = matchPersonIndex(snapshot.locadores, fields);
  if (locadorMatch !== null) return { kind: "locador", index: locadorMatch };
  const locatarioMatch = matchPersonIndex(snapshot.locatarios, fields);
  if (locatarioMatch !== null) return { kind: "locatario", index: locatarioMatch };

  if (matchFiador(snapshot.garantia, fields)) {
    return { kind: "fiador", index: 0 };
  }

  const repLocadorMatch = matchRepresentanteIndex(snapshot.locadores, fields);
  if (repLocadorMatch !== null)
    return { kind: "representante_locador", index: repLocadorMatch };
  const repLocatarioMatch = matchRepresentanteIndex(snapshot.locatarios, fields);
  if (repLocatarioMatch !== null)
    return { kind: "representante_locatario", index: repLocatarioMatch };

  const myKey = personKey(fields);
  if (myKey) {
    for (const sib of siblings) {
      if (!sib.fields) continue;
      if (!sib.category || !PERSON_CATEGORIES.has(sib.category)) continue;
      if (personKey(sib.fields) === myKey) return sib.assignment;
    }
  }

  return { kind: "outro", index: 0 };
}

/** Rótulo humano do slot — usado no dropdown e no chip do DocumentCard. */
export function locacaoSlotLabel(
  assignment: Assignment,
  snapshot: LocacaoFormSnapshot
): string {
  const nameOf = (p: Record<string, unknown> | undefined, fallback: string) => {
    const nome = p?.nome ?? p?.razao_social;
    return typeof nome === "string" && nome.trim() ? nome : fallback;
  };
  const kind = assignment.kind as DocumentKind;
  switch (kind) {
    case "locador":
      return `Locador: ${nameOf(snapshot.locadores?.[assignment.index], `Parte ${assignment.index + 1}`)}`;
    case "locatario":
      return `Locatário: ${nameOf(snapshot.locatarios?.[assignment.index], `Parte ${assignment.index + 1}`)}`;
    case "fiador":
      return `Fiador: ${nameOf(snapshot.garantia?.fiador, "Fiador")}`;
    case "representante_locador":
      return `Representante do locador ${assignment.index + 1}`;
    case "representante_locatario":
      return `Representante do locatário ${assignment.index + 1}`;
    case "imovel":
      return "Imóvel";
    default:
      return "Outros";
  }
}
