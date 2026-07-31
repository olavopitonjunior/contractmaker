import type { UseFormReturn } from "react-hook-form";
import {
  PERSON_CATEGORIES,
  PROPERTY_CATEGORIES,
  coerce,
  inferEstadoCivilFromRegime,
  isUncatalogedPersonDoc,
  parseEndereco,
  pickSpouseFromCertidao,
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
 * - Locação NÃO tem subobjeto `procurador` no schema — procuração só preenche
 *   o representante (PJ) ou o titular.
 * - `ficha_resumo` declara papéis de venda (vendedor/comprador) — fora do
 *   escopo aqui; docs ficha caem em "outro".
 * - `area_total` do OCR vira `imovel.area` (number no schema de locação).
 *
 * O cônjuge EXISTE em locação desde 2026-07-24 (outorga uxória, ver
 * `validation-locacao.ts`); os kinds `conjuge_*` de locação foram ligados aqui
 * em 2026-07-31 — antes disso o OCR não tinha destino pra eles.
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
 * Kinds de LOCAÇÃO cujo basePath é uma pessoa (parte, fiador, representante ou
 * cônjuge).
 */
const PERSON_KINDS_LOCACAO = new Set<DocumentKind>([
  "locador",
  "locatario",
  "fiador",
  "representante_locador",
  "representante_locatario",
  "conjuge_locador",
  "conjuge_locatario",
  "conjuge_fiador",
]);

const CONJUGE_KINDS_LOCACAO = new Set<DocumentKind>([
  "conjuge_locador",
  "conjuge_locatario",
  "conjuge_fiador",
]);

const REPRESENTANTE_KINDS_LOCACAO = new Set<DocumentKind>([
  "representante_locador",
  "representante_locatario",
]);

/**
 * O `representante` de locação é bem mais pobre que o de venda — só
 * nome/cpf/email/mobile_phone (`validation-locacao.ts`). Sem esta trava o
 * autofill gravava rg/data_nascimento/endereço que nenhuma tela lê.
 */
const REPRESENTANTE_ALLOWED_FIELDS_LOCACAO = new Set(["nome", "cpf"]);

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
    case "conjuge_locador":
      return `locadores.${assignment.index}.conjuge`;
    case "conjuge_locatario":
      return `locatarios.${assignment.index}.conjuge`;
    // Fiador não é indexado — o cônjuge dele também não.
    case "conjuge_fiador":
      return "garantia.fiador.conjuge";
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

  // Espelha a venda: categoria conhecida decide como antes; categoria fora do
  // catálogo (ex.: carteira da OAB → "outro") só entra como pessoa quando o
  // slot destino é de pessoa E há evidência de identidade nos campos. Imóvel
  // segue whitelist estrita (não sujar o endereço do imóvel com o da parte).
  const isPerson =
    PERSON_CATEGORIES.has(category) ||
    (PERSON_KINDS_LOCACAO.has(assignment.kind) &&
      isUncatalogedPersonDoc(category, fields));
  const isProperty = PROPERTY_CATEGORIES.has(category);
  const isConjuge = CONJUGE_KINDS_LOCACAO.has(assignment.kind);
  const isRepresentante = REPRESENTANTE_KINDS_LOCACAO.has(assignment.kind);
  let filled = 0;

  // Espelha a venda: com "endereço igual ao do titular" ligado (default true) o
  // endereço do cônjuge não é preenchido — o helper lê do titular.
  let skipAddressForConjuge = false;
  if (isConjuge) {
    skipAddressForConjuge =
      form.getValues(`${basePath}.endereco_igual_ao_titular`) !== false;
  }

  const parentPathOf = (suffix: string): string | null =>
    basePath.endsWith(`.${suffix}`)
      ? basePath.slice(0, -(suffix.length + 1))
      : null;

  const applyField = (formField: string, raw: unknown) => {
    if (skipAddressForConjuge && ADDRESS_FIELDS.has(formField)) return;
    if (isRepresentante && !REPRESENTANTE_ALLOWED_FIELDS_LOCACAO.has(formField)) {
      return;
    }
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

    // Certidão de casamento atribuída ao cônjuge: escolhe qual dos dois
    // nubentes é o cônjuge do slot comparando com o titular pai (D1, helper
    // compartilhado com a venda).
    if (isConjuge && category === "certidao_casamento") {
      const parentPath = parentPathOf("conjuge");
      const parent = parentPath
        ? {
            nome: form.getValues(`${parentPath}.nome`),
            cpf: form.getValues(`${parentPath}.cpf`),
          }
        : null;
      const spouse = pickSpouseFromCertidao(fields, parent);
      if (spouse.nome) applyField("nome", spouse.nome);
      if (spouse.cpf) applyField("cpf", spouse.cpf);
    }

    // D2 — estado civil colateral do pai (só se vazio). Sem isso os campos
    // aplicados ficam invisíveis: a UI do cônjuge só renderiza pra parte casada.
    if (isConjuge) {
      const parentPath = parentPathOf("conjuge");
      if (parentPath) {
        const current = form.getValues(`${parentPath}.estado_civil`);
        if (current === undefined || current === null || current === "") {
          const inferred =
            (category === "certidao_casamento"
              ? inferEstadoCivilFromRegime(fields.regime_bens)
              : null) ?? "Casado(a)";
          form.setValue(`${parentPath}.estado_civil`, inferred as never, {
            shouldDirty: true,
            shouldTouch: true,
          });
          filled += 1;
        }
      }
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

/** Match contra parte.conjuge.cpf/nome em locadores ou locatários. */
function matchConjugeIndex(
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
    const c = (list[i]?.conjuge ?? {}) as Record<string, unknown>;
    const cCpf = sanitizeCpf(c.cpf);
    if (extractedCpf && cCpf && extractedCpf === cCpf) return i;
    if (
      extractedNome &&
      typeof c.nome === "string" &&
      c.nome.trim().toLowerCase() === extractedNome
    ) {
      return i;
    }
  }
  return null;
}

/** Match contra garantia.fiador.conjuge (fiador não é indexado). */
function matchConjugeFiador(
  garantia: LocacaoFormSnapshot["garantia"],
  fields: Record<string, unknown>
): boolean {
  const conjuge = (garantia?.fiador?.conjuge ?? null) as Record<
    string,
    unknown
  > | null;
  if (!conjuge) return false;
  const extractedCpf = sanitizeCpf(fields.cpf_numero);
  const extractedNome =
    typeof fields.nome_completo === "string"
      ? fields.nome_completo.trim().toLowerCase()
      : null;
  const cCpf = sanitizeCpf(conjuge.cpf);
  if (extractedCpf && cCpf && extractedCpf === cCpf) return true;
  if (
    extractedNome &&
    typeof conjuge.nome === "string" &&
    conjuge.nome.trim().toLowerCase() === extractedNome
  ) {
    return true;
  }
  return false;
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
 *   4. match cônjuge (locadores/locatarios/fiador) — espelha a venda
 *   5. match representante de parte PJ
 *   6. sibling identity — mesma pessoa em outro doc desta sessão
 *   7. fallback "outro" — usuário escolhe no dropdown
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

  // Categoria de pessoa OU doc fora do catálogo com evidência de identidade
  // (ex.: carteira da OAB classificada como "outro").
  if (
    !PERSON_CATEGORIES.has(category) &&
    !isUncatalogedPersonDoc(category, fields)
  ) {
    return { kind: "outro", index: 0 };
  }

  const locadorMatch = matchPersonIndex(snapshot.locadores, fields);
  if (locadorMatch !== null) return { kind: "locador", index: locadorMatch };
  const locatarioMatch = matchPersonIndex(snapshot.locatarios, fields);
  if (locatarioMatch !== null) return { kind: "locatario", index: locatarioMatch };

  if (matchFiador(snapshot.garantia, fields)) {
    return { kind: "fiador", index: 0 };
  }

  const conjugeLocadorMatch = matchConjugeIndex(snapshot.locadores, fields);
  if (conjugeLocadorMatch !== null)
    return { kind: "conjuge_locador", index: conjugeLocadorMatch };
  const conjugeLocatarioMatch = matchConjugeIndex(snapshot.locatarios, fields);
  if (conjugeLocatarioMatch !== null)
    return { kind: "conjuge_locatario", index: conjugeLocatarioMatch };
  if (matchConjugeFiador(snapshot.garantia, fields)) {
    return { kind: "conjuge_fiador", index: 0 };
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
      if (!sib.category) continue;
      if (
        !PERSON_CATEGORIES.has(sib.category) &&
        !isUncatalogedPersonDoc(sib.category, sib.fields)
      ) {
        continue;
      }
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
    case "conjuge_locador":
      return `Cônjuge do locador ${assignment.index + 1}`;
    case "conjuge_locatario":
      return `Cônjuge do locatário ${assignment.index + 1}`;
    case "conjuge_fiador":
      return "Cônjuge do fiador";
    case "imovel":
      return "Imóvel";
    default:
      return "Outros";
  }
}
