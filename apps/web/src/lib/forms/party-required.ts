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

const PARTY_PATH_RE = /^(vendedores|compradores)\.(\d+)\.(.+)$/;

// Campos exclusivos de Pessoa Física — não têm equivalente em PJ.
const PF_ONLY_PARTY_FIELDS = new Set([
  "estado_civil",
  "rg",
  "nome_mae",
  "data_nascimento",
  "naturalidade",
  "profissao",
  "sexo",
]);

// Identidade: o que em PF é cpf/nome, em PJ vira cnpj/razão social.
const PJ_IDENTITY_REMAP: Record<string, string> = {
  cpf: "cnpj",
  nome: "razao_social",
};

export interface ParsedPartyPath {
  list: "vendedores" | "compradores";
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
    list: m[1] as "vendedores" | "compradores",
    idx: Number(m[2]),
    field: m[3],
  };
}

/** Regra de "vazio" única — idêntica à checagem manual do wizard. */
export function isValueEmpty(raw: unknown): boolean {
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
  const pushPartyField = (
    list: "vendedores" | "compradores",
    idx: number,
    field: string,
  ) => {
    const base = `${list}.${idx}.${field}`;
    const isPJ = getValue(`${list}.${idx}.tipo_pessoa`) === "juridica";
    if (!isPJ) return push(base);
    // Campo aninhado de parte (ex.: conjuge.nome) — não remapeia, mantém.
    if (field.includes(".")) return push(base);
    // PF-only num PJ: simplesmente não é obrigatório.
    if (PF_ONLY_PARTY_FIELDS.has(field)) return;
    const remapped = PJ_IDENTITY_REMAP[field];
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
 * Conveniência: paths efetivos que estão vazios no form. `getValue` lê o valor
 * atual de cada path.
 */
export function findMissingRequired(
  paths: readonly string[],
  getValue: (path: string) => unknown,
): string[] {
  return effectiveRequiredPaths(paths, getValue).filter((p) =>
    isValueEmpty(getValue(p)),
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
      if (isValueEmpty(getValue(`${list}.${idx}.${field}`))) {
        out.push({ list, idx, field });
      }
    }
  }
  return out;
}
