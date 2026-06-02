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

  for (const path of paths) {
    const parsed = parsePartyPath(path);
    if (!parsed) {
      push(path);
      continue;
    }
    const isPJ =
      getValue(`${parsed.list}.${parsed.idx}.tipo_pessoa`) === "juridica";
    if (!isPJ) {
      push(path);
      continue;
    }
    // Campo aninhado de parte (ex.: conjuge.nome) — não remapeia, mantém.
    if (parsed.field.includes(".")) {
      push(path);
      continue;
    }
    // PF-only num PJ: simplesmente não é obrigatório.
    if (PF_ONLY_PARTY_FIELDS.has(parsed.field)) continue;
    const remapped = PJ_IDENTITY_REMAP[parsed.field];
    push(`${parsed.list}.${parsed.idx}.${remapped ?? parsed.field}`);
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
