/**
 * Resolução de obrigatoriedade ciente de `tipo_pessoa` + checagem de "vazio".
 *
 * Os presets (lib/forms/presets.ts) declaram paths canônicos de Pessoa Física
 * (`cpf`, `estado_civil`, `rg`...). Quando a parte (vendedor/comprador) é Pessoa
 * Jurídica, esses campos não existem na ficha — exigi-los gera "pendência
 * fantasma": o stepper acusa falta, mas não há campo na tela pra corrigir.
 *
 * Este módulo remapeia os paths de parte conforme o `tipo_pessoa` ATUAL do
 * form (não o do preset estático), porque o usuário pode alternar PF/PJ depois
 * do load — então a decisão precisa rodar no cliente, a cada render.
 *
 * Regras:
 *  - campos PF-only (estado civil, RG, nome da mãe, nascimento, ...) → ignorados
 *    em PJ;
 *  - identidade fiscal: `cpf` → `cnpj`, `nome` → `razao_social` em PJ;
 *  - endereço/contato (endereco, cidade, uf, cep, email, telefone) → valem nos
 *    dois;
 *  - paths que não são de parte (ex.: `imoveis.0.rua`, `pagamento.valor_total`,
 *    o path "guarda-chuva" `vendedores`) passam intactos.
 */

import { isMarried } from "@/lib/forms/estado-civil";

// 2026-07-28 — locadores/locatarios entram no regex: locação passou a ter
// presets de obrigatoriedade próprios (lib/forms/presets.ts) e precisa do
// mesmo remap PF/PJ. `garantia.fiador.*` fica de fora de propósito: não é
// lista indexada e a obrigatoriedade do fiador é condicional ao tipo de
// garantia (fica em collectLocacaoFinalizeIssues).
const PARTY_PATH_RE =
  /^(vendedores|compradores|locadores|locatarios)\.(\d+)\.(.+)$/;

export type PartyListKey =
  | "vendedores"
  | "compradores"
  | "locadores"
  | "locatarios";

const LOCACAO_LISTS: ReadonlySet<string> = new Set(["locadores", "locatarios"]);

// Campos exclusivos de Pessoa Física — não têm equivalente em PJ.
// `nacionalidade` entrou junto com locação: nem o bloco PJ de venda nem o de
// locação renderizam esse campo no titular (em PJ ele só existe dentro de
// `representante`), então exigi-lo geraria pendência fantasma.
const PF_ONLY_PARTY_FIELDS = new Set([
  "estado_civil",
  "rg",
  "nome_mae",
  "data_nascimento",
  "naturalidade",
  "nacionalidade",
  "profissao",
  "sexo",
]);

// Identidade: o que em PF é cpf/nome, em PJ vira cnpj/razão social.
const PJ_IDENTITY_REMAP: Record<string, string> = {
  cpf: "cnpj",
  nome: "razao_social",
};

// Locação, PJ: e-mail e celular do titular não existem na ficha da empresa —
// quem assina pela PJ é o representante legal, e é lá que o wizard renderiza
// os campos. Sem este remap, exigir `locadores.0.email` numa PJ trava o avanço
// num campo que não está na tela. Em VENDA o comportamento fica como estava
// (o preset de venda já exigia `email` no titular há tempos).
const PJ_LOCACAO_CONTACT_REMAP: Record<string, string> = {
  email: "representante.email",
  mobile_phone: "representante.mobile_phone",
};

export interface ParsedPartyPath {
  list: PartyListKey;
  idx: number;
  field: string;
}

/**
 * Quebra um path tipo `vendedores.0.cpf` em `{ list, idx, field }`.
 * Retorna null pra qualquer coisa que não seja um campo escalar de parte
 * (inclui o path "guarda-chuva" `vendedores` e paths de outras seções).
 */
export function parsePartyPath(path: string): ParsedPartyPath | null {
  const m = PARTY_PATH_RE.exec(path);
  if (!m) return null;
  return {
    list: m[1] as PartyListKey,
    idx: Number(m[2]),
    field: m[3],
  };
}

/**
 * Campos onde `0` é "não preenchido", não uma resposta.
 *
 * O Zod dá `.default(0)` a quase todo campo de dinheiro e medida, então o valor
 * nasce zero e NUNCA fica `undefined`. Sem esta lista, marcar
 * `pagamento.valor_total` como obrigatório (ele está em TODOS os presets de
 * venda) não bloqueava nada: o formulário era concluído com valor total zero.
 * O piso de locação já tratava `aluguel.valor` assim, por conta própria e com
 * regra própria — as duas leituras de "vazio" agora são a mesma.
 *
 * A lista é deliberadamente curta. `vagas_garagem: 0`, `caucao_meses: 0` e
 * `isencao_multa_meses: 0` são RESPOSTAS legítimas ("nenhuma") e ficam de fora.
 */
const ZERO_IS_EMPTY_FIELDS: ReadonlySet<string> = new Set([
  // Dinheiro
  "valor_total",
  "valor",
  "sinal_arras",
  "renda_mensal",
  "faturamento_mensal",
  "taxa_locacao_valor",
  "valor_fixo",
  // Medida / prazo que não faz sentido zerado
  "area",
  "vigencia_meses",
  "dia_vencimento",
  "taxa_admin_percent",
  "taxa_locacao_percent",
  "percentual",
]);

/**
 * Regra de "vazio" única — idêntica à checagem manual do wizard.
 *
 * `path` é opcional por retrocompat: sem ele, `0` continua sendo um valor
 * preenchido (é o que `blank-party` espera ao decidir se uma linha de parte
 * está em branco).
 */
export function isValueEmpty(raw: unknown, path?: string): boolean {
  if (
    raw === 0 &&
    path &&
    ZERO_IS_EMPTY_FIELDS.has(path.split(".").pop() as string)
  ) {
    return true;
  }
  return (
    raw === undefined ||
    raw === null ||
    raw === "" ||
    (Array.isArray(raw) && raw.length === 0)
  );
}

/** Lê um path pontilhado (`a.0.b`) de um objeto aninhado. */
export function getByPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/**
 * Remapeia a lista de paths obrigatórios conforme o `tipo_pessoa` vivo de cada
 * parte. `getValue(path)` deve devolver o valor atual do form pra aquele path
 * (usado pra ler `<lista>.<idx>.tipo_pessoa`). Resultado é dedupado.
 *
 * 2026-06-03 — Expansão por parte: os presets declaram os campos no índice `.0.`
 * (ex.: `vendedores.0.email`), mas a exigência vale para TODA parte titular —
 * senão um 2º vendedor (ex.: a PJ co-vendedora) não tem e-mail/documento exigido
 * e cai em `missing` só na hora de assinar. Paths de índice 0 são expandidos para
 * todos os índices existentes da lista; cada índice ainda passa pelo remap PJ.
 */
export function effectiveRequiredPaths(
  paths: readonly string[],
  getValue: (path: string) => unknown,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (p: string) => {
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  };

  // Aplica o remap PJ a UM (list, idx, field) e empurra o path resultante.
  const pushPartyField = (list: PartyListKey, idx: number, field: string) => {
    const base = `${list}.${idx}.${field}`;
    const isPJ = getValue(`${list}.${idx}.tipo_pessoa`) === "juridica";
    if (!isPJ) return push(base);
    // Campo aninhado de parte (ex.: conjuge.nome) — não remapeia, mantém.
    if (field.includes(".")) return push(base);
    // PF-only num PJ: simplesmente não é obrigatório.
    if (PF_ONLY_PARTY_FIELDS.has(field)) return;
    const contact = LOCACAO_LISTS.has(list)
      ? PJ_LOCACAO_CONTACT_REMAP[field]
      : undefined;
    const remapped = contact ?? PJ_IDENTITY_REMAP[field];
    push(`${list}.${idx}.${remapped ?? field}`);
  };

  // Quantas partes existem na lista (≥1 mantém a garantia do índice 0 mesmo
  // quando o array ainda não foi lido).
  const partyCount = (list: string): number => {
    const arr = getValue(list);
    return Array.isArray(arr) && arr.length > 0 ? arr.length : 1;
  };

  for (const path of paths) {
    const parsed = parsePartyPath(path);
    if (!parsed) {
      push(path);
      continue;
    }
    // Índice 0 do preset → expande para todas as partes existentes; índice
    // explícito não-zero (raro) mantém só aquele.
    if (parsed.idx === 0) {
      const n = partyCount(parsed.list);
      for (let i = 0; i < n; i++) pushPartyField(parsed.list, i, parsed.field);
    } else {
      pushPartyField(parsed.list, parsed.idx, parsed.field);
    }
  }
  return out;
}

/**
 * Obrigatoriedade CONDICIONAL da matrícula (venda).
 *
 * Quando o cliente marca "a matrícula atualizada deverá ser solicitada", número
 * e cartório deixam de ser opcionais: são eles que identificam o que pedir ao
 * registro — sem os dois, a pendência que vai parar na tela do negócio é
 * inacionável ("solicitar matrícula de qual imóvel, em que cartório?").
 *
 * Vive aqui, junto do resto da resolução de obrigatórios, porque precisa ser
 * somada em TODOS os consumidores da lista — gate de navegação, contagem de
 * pendências e asterisco. Um consumidor que esqueça de somar mostra uma
 * verdade diferente dos outros, que é o defeito clássico deste módulo.
 */
export function matriculaConditionalPaths(
  getValue: (path: string) => unknown,
): string[] {
  const imoveis = getValue("imoveis");
  const n = Array.isArray(imoveis) && imoveis.length > 0 ? imoveis.length : 1;
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    if (getValue(`imoveis.${i}.matricula_situacao`) !== "solicitar") continue;
    out.push(`imoveis.${i}.matricula`, `imoveis.${i}.cartorio`);
  }
  return out;
}

/**
 * Mesma regra para LOCAÇÃO, onde o imóvel é objeto singular (`imovel`) em vez
 * de array.
 *
 * Existe porque o bloco da matrícula foi para a etapa do imóvel de locação
 * (2026-08) e o rádio "deverá ser solicitada" prometia uma obrigatoriedade que
 * nenhum consumidor aplicava: a versão de venda é indexada em `imoveis.${i}` e
 * só o SalesFormWizard a somava.
 */
export function matriculaConditionalPathsLocacao(
  getValue: (path: string) => unknown,
): string[] {
  if (getValue("imovel.matricula_situacao") !== "solicitar") return [];
  return ["imovel.matricula", "imovel.cartorio"];
}

/**
 * Conveniência: paths efetivos que estão vazios no form. `getValue` lê o valor
 * atual de cada path.
 */
export function findMissingRequired(
  paths: readonly string[],
  getValue: (path: string) => unknown,
): string[] {
  return effectiveRequiredPaths(paths, getValue).filter((p) =>
    isValueEmpty(getValue(p), p),
  );
}

// -------------------------------------------------------------------
// Guarda HÍBRIDA de completude (2026-06-02): além da obrigatoriedade dura do
// preset (que cobre o mínimo de assinatura — nome/cpf/email do titular), o
// wizard mostra uma RECOMENDAÇÃO não-bloqueante destes campos PF, necessários
// pras certidões. Sem eles, endpoints específicos falham ou viram SkippedJob:
//   - rg   + sexo  → TJSP pedido-certidao (606 sem)
//   - data_nascimento → TJSP / PGFN / Receita CPF
//   - nome_mae → TJSP (alguns modelos, 606)
// PJ não usa (campos PF-only — ver PF_ONLY_PARTY_FIELDS).
// -------------------------------------------------------------------
export const CERTIDAO_RECOMMENDED_PARTY_FIELDS = [
  "rg",
  "data_nascimento",
  "nome_mae",
  "sexo",
] as const;

export const CERTIDAO_FIELD_LABELS: Record<string, string> = {
  rg: "RG",
  data_nascimento: "Data de nascimento",
  nome_mae: "Nome da mãe",
  sexo: "Sexo",
};

export interface CertidaoRecommendation {
  list: "vendedores" | "compradores";
  idx: number;
  field: string;
}

/**
 * Recomendações (não-bloqueantes) de campos de certidão vazios para as partes
 * PF de uma lista. PJ é ignorado. NÃO entra na obrigatoriedade do preset —
 * alimenta apenas o aviso informativo do wizard.
 */
export function findCertidaoRecommendations(
  list: "vendedores" | "compradores",
  count: number,
  getValue: (path: string) => unknown,
): CertidaoRecommendation[] {
  const out: CertidaoRecommendation[] = [];
  for (let idx = 0; idx < count; idx++) {
    const isPJ = getValue(`${list}.${idx}.tipo_pessoa`) === "juridica";
    if (isPJ) continue;
    for (const field of CERTIDAO_RECOMMENDED_PARTY_FIELDS) {
      const certidaoPath = `${list}.${idx}.${field}`;
      if (isValueEmpty(getValue(certidaoPath), certidaoPath)) {
        out.push({ list, idx, field });
      }
    }
  }
  return out;
}

// -------------------------------------------------------------------
// Segunda guarda híbrida (2026-07-24): e-mail das SUB-PARTES.
//
// Cônjuge, procurador e representante legal viram signatários próprios na
// ClickSign (subKind no envelope), e sem e-mail eles não recebem o link — a
// popup de envio trava exigindo o dado que ninguém coletou. Aqui a exigência
// é RECOMENDAÇÃO, não bloqueio: o titular continua sendo o único e-mail duro
// do preset, porque o cliente nem sempre sabe o e-mail do cônjuge na hora.
//
// Só recomenda para sub-parte que JÁ FOI PREENCHIDA e que é aplicável ao tipo
// da parte — senão vira "pendência fantasma" (aviso sobre campo que a tela
// nem renderiza), o mesmo problema que effectiveRequiredPaths evita.
// -------------------------------------------------------------------

export type PartySubKey = "conjuge" | "procurador" | "representante";

export const PARTY_SUB_LABELS: Record<PartySubKey, string> = {
  conjuge: "cônjuge",
  procurador: "procurador",
  representante: "representante legal",
};

export interface SignatureRecommendation {
  /** "vendedores" | "compradores" | "locadores" | "locatarios" | "garantia" */
  list: string;
  idx: number;
  sub: PartySubKey;
  field: "email";
}

/**
 * A sub-parte existe na ficha desta parte? Espelha as condições de render dos
 * steps: cônjuge só em PF casada/união estável, representante só em PJ,
 * procurador só quando o checkbox "Possui procurador" está marcado.
 *
 * `tipo_pessoa` é comparado por `!== "juridica"` (e não `=== "fisica"`) porque
 * dataJson de OCR/legado às vezes chega sem o campo, e o default do form é PF.
 */
export function isPartySubApplicable(
  prefix: string,
  sub: PartySubKey,
  getValue: (path: string) => unknown,
): boolean {
  const isPJ = getValue(`${prefix}.tipo_pessoa`) === "juridica";
  switch (sub) {
    case "representante":
      return isPJ;
    case "conjuge":
      return !isPJ && isMarried(getValue(`${prefix}.estado_civil`));
    case "procurador":
      return !isPJ && getValue(`${prefix}.tem_procurador`) === true;
  }
}

const ALL_PARTY_SUBS: readonly PartySubKey[] = [
  "conjuge",
  "procurador",
  "representante",
];

/**
 * Sub-partes preenchidas (têm `nome`) e aplicáveis que estão sem e-mail.
 * `list` é `string` de propósito — locação reusa a mesma função com
 * `locadores`/`locatarios` e não tem sistema de presets.
 */
export function findSignatureRecommendations(
  list: string,
  count: number,
  getValue: (path: string) => unknown,
): SignatureRecommendation[] {
  const out: SignatureRecommendation[] = [];
  for (let idx = 0; idx < count; idx++) {
    const prefix = `${list}.${idx}`;
    for (const sub of ALL_PARTY_SUBS) {
      if (!isPartySubApplicable(prefix, sub, getValue)) continue;
      if (isValueEmpty(getValue(`${prefix}.${sub}.nome`))) continue;
      if (isValueEmpty(getValue(`${prefix}.${sub}.email`))) {
        out.push({ list, idx, sub, field: "email" });
      }
    }
  }
  return out;
}
