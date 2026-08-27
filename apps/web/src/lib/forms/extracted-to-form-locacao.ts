import type { UseFormReturn } from "react-hook-form";
import {
  PERSON_CATEGORIES,
  PROPERTY_CATEGORIES,
  FICHA_PAPEIS_LOCACAO,
  coerce,
  matchFichaResumo,
  inferEstadoCivilFromRegime,
  isUncatalogedPersonDoc,
  parseEndereco,
  pickSpouseFromCertidao,
  titularSideInCertidao,
  sanitizeCpf,
  sanitizeUf,
  type Assignment,
  type DocumentKind,
  type ExtractedDoc,
  type FichaResumoData,
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
//
// A qualificação (nacionalidade, estado civil, profissão) e o contato
// (e-mail, celular) ESTÃO no parteLocacaoSchema e estavam sendo descartados:
// o OCR extraía e o mapa não conhecia a chave. Era a queixa "não puxou CPF,
// endereço e profissão dos locatários" de 2026-08-25.
const FIELD_MAP_PERSON_LOCACAO: Record<string, string> = {
  nome_completo: "nome",
  titular_nome: "nome",
  rg_numero: "rg",
  cpf_numero: "cpf",
  data_nascimento: "data_nascimento",
  nacionalidade: "nacionalidade",
  estado_civil: "estado_civil",
  profissao: "profissao",
  email: "email",
  telefone: "mobile_phone",
  mobile_phone: "mobile_phone",
  numero: "numero",
  complemento: "complemento",
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
/** Partes de verdade (não sub-slots): o doc atribuído a elas qualifica ELAS. */
const TITULAR_KINDS_LOCACAO = new Set<DocumentKind>([
  "locador",
  "locatario",
  "fiador",
]);

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
  const isTitular = TITULAR_KINDS_LOCACAO.has(assignment.kind);
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

    // Certidão de casamento atribuída à PRÓPRIA parte. Locação não tinha este
    // ramo: uma certidão anexada ao locatário não inferia o estado civil, não
    // preenchia o cônjuge e jogava fora a qualificação (profissão,
    // nacionalidade, nascimento) dos dois nubentes. Espelha a venda.
    if (isTitular && category === "certidao_casamento") {
      const estadoCivil = inferEstadoCivilFromRegime(fields.regime_bens);
      if (estadoCivil) applyField("estado_civil", estadoCivil);

      const parent = {
        nome: form.getValues(`${basePath}.nome`),
        cpf: form.getValues(`${basePath}.cpf`),
      };
      const side = titularSideInCertidao(fields, parent);
      applyField("profissao", fields[`conjuge${side}_profissao`]);
      applyField("nacionalidade", fields[`conjuge${side}_nacionalidade`]);
      applyField("data_nascimento", fields[`conjuge${side}_data_nascimento`]);

      const spouse = pickSpouseFromCertidao(fields, parent);
      const setConjuge = (campo: string, valor: string | null) => {
        if (!valor) return;
        const path = `${basePath}.conjuge.${campo}`;
        if (form.getValues(path)) return;
        form.setValue(path, valor as never, {
          shouldDirty: true,
          shouldTouch: true,
        });
        filled += 1;
      };
      setConjuge("nome", spouse.nome);
      setConjuge("cpf", spouse.cpf);
      setConjuge("profissao", spouse.profissao);
      setConjuge("nacionalidade", spouse.nacionalidade);
      setConjuge("data_nascimento", spouse.dataNascimento);
    }

    // Procuração. Antes deste ramo ela preenchia ZERO campos em locação: o
    // mapa não conhece `outorgante_*`/`outorgado_*`. Mesma divisão da venda —
    // outorgante é a parte, outorgado é o representante.
    if (category === "procuracao") {
      if (isRepresentante) {
        applyField("nome", fields.outorgado_nome);
        applyField("cpf", fields.outorgado_cpf);
      } else if (isTitular) {
        applyField("nome", fields.outorgante_nome);
        applyField("cpf", fields.outorgante_cpf);
        applyField("rg", fields.outorgante_rg);
        applyField("nacionalidade", fields.outorgante_nacionalidade);
        applyField("estado_civil", fields.outorgante_estado_civil);
        applyField("profissao", fields.outorgante_profissao);
        const parsedOutorgante = parseEndereco(
          fields.outorgante_endereco_completo
        );
        if (parsedOutorgante.rua) applyField("endereco", parsedOutorgante.rua);
        if (parsedOutorgante.numero)
          applyField("numero", parsedOutorgante.numero);
      }
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
      if (spouse.profissao) applyField("profissao", spouse.profissao);
      if (spouse.nacionalidade) applyField("nacionalidade", spouse.nacionalidade);
      if (spouse.dataNascimento)
        applyField("data_nascimento", spouse.dataNascimento);
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

  // A própria ficha-resumo não é de ninguém: ela DECLARA os papéis dos outros
  // (o efeito da etapa 0 chama `applyFicha` quando ela fica pronta).
  if (category === "ficha_resumo") return { kind: "outro", index: 0 };

  // Categoria de pessoa OU doc fora do catálogo com evidência de identidade
  // (ex.: carteira da OAB classificada como "outro").
  if (
    !PERSON_CATEGORIES.has(category) &&
    !isUncatalogedPersonDoc(category, fields)
  ) {
    return { kind: "outro", index: 0 };
  }

  // 1. Papel declarado numa ficha-resumo desta sessão tem prioridade máxima —
  // é a única fonte que sabe QUEM é quem antes de o form estar preenchido.
  const fichaMatch = matchFichaResumo(fields, siblings, FICHA_PAPEIS_LOCACAO);
  if (fichaMatch) return fichaMatch;

  // 2. Procuração: o outorgante é a PARTE, o outorgado é o representante.
  // Antes disto ela caía sempre em "outro" (o match é feito sobre
  // `nome_completo`/`cpf_numero`, chaves que a procuração não devolve) e o
  // gate H.5 travava o "Aplicar aos campos" do formulário inteiro.
  if (category === "procuracao") {
    const outorgante = {
      nome_completo: fields.outorgante_nome,
      cpf_numero: fields.outorgante_cpf,
    };
    const locadorOutorgante = matchPersonIndex(snapshot.locadores, outorgante);
    if (locadorOutorgante !== null)
      return { kind: "representante_locador", index: locadorOutorgante };
    const locatarioOutorgante = matchPersonIndex(snapshot.locatarios, outorgante);
    if (locatarioOutorgante !== null)
      return { kind: "representante_locatario", index: locatarioOutorgante };
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

/**
 * Aplica uma ficha-resumo (dossiê consolidado da imobiliária) num formulário de
 * LOCAÇÃO — espelho de `applyFichaResumo` da venda.
 *
 * Sem isto, a ficha em PDF era classificada, extraída e **descartada**: os
 * papéis de locação não existiam em `FICHA_PAPEIS`, o `locacaoDocAdapter` não
 * implementava `applyFicha` e o documento caía em "outro", preenchendo zero
 * campos (e ainda travando o botão "Aplicar" pelo gate H.5). Foi o teste que a
 * corretora ficou de fazer na sessão de 2026-08-25.
 *
 * Diferenças estruturais em relação à venda:
 *  - `imovel` é objeto SINGULAR (um imóvel por contrato), não array;
 *  - o fiador mora em `garantia.fiador`, fora de qualquer array;
 *  - não há procurador em locação (o schema não tem o sub-objeto).
 */
export function applyFichaResumoLocacao(
  data: FichaResumoData,
  form: UseFormReturn<Record<string, unknown>>,
  options: { skipIfDirty?: boolean } = {}
): number {
  const { skipIfDirty = true } = options;
  let filled = 0;

  const setIfEmpty = (path: string, value: unknown) => {
    if (value === undefined || value === null || value === "") return;
    const formField = path.slice(path.lastIndexOf(".") + 1);
    const coerced = coerce(formField, value);
    if (coerced === undefined || coerced === null || coerced === "") return;
    if (skipIfDirty) {
      const current = form.getValues(path);
      if (current !== undefined && current !== null && current !== "") return;
    }
    form.setValue(path, coerced as never, { shouldDirty: true, shouldTouch: true });
    filled += 1;
  };

  const ensureSlot = (
    listKey: "locadores" | "locatarios",
    index: number,
    template: Record<string, unknown>
  ) => {
    const current = (form.getValues(listKey) as unknown[] | undefined) ?? [];
    if (current.length > index) return;
    const next = [...current];
    while (next.length <= index) next.push({ ...template });
    form.setValue(listKey, next as never, { shouldDirty: true });
  };

  if (Array.isArray(data.partes)) {
    for (const p of data.partes) {
      if (!p || typeof p !== "object") continue;
      const papel = p.papel as DocumentKind | undefined;
      if (!papel || !FICHA_PAPEIS_LOCACAO.has(papel)) continue;
      const idx =
        typeof p.indice_referencia === "number" && p.indice_referencia >= 0
          ? p.indice_referencia
          : 0;

      const isConjuge = CONJUGE_KINDS_LOCACAO.has(papel);
      const isRep = REPRESENTANTE_KINDS_LOCACAO.has(papel);
      const isPj = !!p.cnpj || !!p.razao_social;

      // O fiador não é array: vive em `garantia.fiador`, e declarar um na ficha
      // é afirmação de que a garantia é fiança.
      let parentPrefix: string;
      if (papel === "fiador" || papel === "conjuge_fiador") {
        parentPrefix = "garantia.fiador";
        const tipoAtual = form.getValues("garantia.tipo");
        if (tipoAtual !== "fiador") {
          form.setValue("garantia.tipo", "fiador" as never, {
            shouldDirty: true,
            shouldTouch: true,
          });
          filled += 1;
        }
      } else {
        const listKey: "locadores" | "locatarios" =
          papel === "locador" ||
          papel === "conjuge_locador" ||
          papel === "representante_locador"
            ? "locadores"
            : "locatarios";
        ensureSlot(
          listKey,
          idx,
          isPj ? { tipo_pessoa: "juridica" } : { tipo_pessoa: "fisica" }
        );
        parentPrefix = `${listKey}.${idx}`;
      }

      let prefix = parentPrefix;
      if (isConjuge) prefix = `${prefix}.conjuge`;
      else if (isRep) prefix = `${prefix}.representante`;

      // O representante de locação é o sub-objeto mais pobre do schema
      // (nome/cpf/email/mobile_phone) — escrever fora dele criaria chave órfã.
      if (isRep) {
        setIfEmpty(`${prefix}.nome`, p.nome);
        const repCpf = sanitizeCpf(p.cpf);
        if (repCpf) setIfEmpty(`${prefix}.cpf`, repCpf);
        setIfEmpty(`${prefix}.email`, p.email);
        continue;
      }

      if (!isConjuge) {
        if (isPj) {
          setIfEmpty(`${prefix}.tipo_pessoa`, "juridica");
          setIfEmpty(`${prefix}.razao_social`, p.razao_social);
          setIfEmpty(`${prefix}.cnpj`, p.cnpj);
        } else {
          setIfEmpty(`${prefix}.tipo_pessoa`, "fisica");
        }
      }

      setIfEmpty(`${prefix}.nome`, p.nome);
      const cpfClean = sanitizeCpf(p.cpf);
      if (cpfClean) setIfEmpty(`${prefix}.cpf`, cpfClean);
      setIfEmpty(`${prefix}.rg`, p.rg);
      setIfEmpty(`${prefix}.data_nascimento`, p.data_nascimento);
      setIfEmpty(`${prefix}.profissao`, p.profissao);
      setIfEmpty(`${prefix}.nacionalidade`, p.nacionalidade);
      setIfEmpty(`${prefix}.email`, p.email);
      if (!isConjuge) setIfEmpty(`${prefix}.estado_civil`, p.estado_civil);

      // Cônjuge só recebe endereço quando marcou que tem endereço próprio.
      const skipAddress = isConjuge
        ? form.getValues(`${prefix}.endereco_igual_ao_titular`) !== false
        : false;
      if (!skipAddress) {
        setIfEmpty(`${prefix}.endereco`, p.endereco);
        setIfEmpty(`${prefix}.numero`, p.numero);
        setIfEmpty(`${prefix}.complemento`, p.complemento);
        setIfEmpty(`${prefix}.bairro`, p.bairro);
        setIfEmpty(`${prefix}.cidade`, p.cidade);
        const uf = sanitizeUf(p.uf);
        if (uf) setIfEmpty(`${prefix}.uf`, uf);
        setIfEmpty(`${prefix}.cep`, p.cep);
      }
    }
  }

  // Locação tem UM imóvel: a ficha pode listar vários, mas só o primeiro entra.
  if (Array.isArray(data.imoveis) && data.imoveis.length > 0) {
    const im = data.imoveis[0];
    if (im && typeof im === "object") {
      setIfEmpty("imovel.rua", im.rua);
      setIfEmpty("imovel.numero", im.numero);
      setIfEmpty("imovel.bairro", im.bairro);
      setIfEmpty("imovel.cidade", im.cidade);
      const uf = sanitizeUf(im.uf);
      if (uf) setIfEmpty("imovel.uf", uf);
      setIfEmpty("imovel.cep", im.cep);
      setIfEmpty("imovel.matricula", im.matricula);
      setIfEmpty("imovel.cartorio", im.cartorio);
      setIfEmpty("imovel.inscricao_iptu", im.inscricao_iptu);
      setIfEmpty("imovel.descricao", im.descricao);
    }
  }

  return filled;
}
