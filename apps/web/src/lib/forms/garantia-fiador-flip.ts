import type { DocumentKind } from "@/lib/forms/extracted-to-form";

/**
 * Regra "documento no fiador ⇒ a garantia é fiança" (2026-09-02).
 *
 * Atribuir um documento ao fiador (ou ao cônjuge dele) na etapa Documentos é
 * afirmação de que a modalidade de garantia é fiador — a mesma leitura que a
 * ficha-resumo já fazia (`applyFichaResumoLocacao`). Antes disso o grupo
 * "Fiador" do seletor só aparecia depois de o usuário escolher a modalidade na
 * etapa 5, que vem DEPOIS da etapa 0: num formulário novo ele nunca aparecia.
 *
 * Módulo puro e compartilhado: o adapter da etapa 0 (cliente, RHF), o autofill
 * server-side (`applyExtractedToDataJson`) e o PATCH admin de reatribuição de
 * anexo aplicam exatamente a mesma regra.
 *
 * O flip é efeito colateral de um EVENTO de atribuição — nunca do `apply` do
 * mapper (o `computeDocWrites` sondaria a escrita e o D7 a apagaria na
 * reatribuição) e nunca de um effect de restore (o usuário pode ter trocado
 * para caução depois; a escolha manual vence).
 */

export const FIADOR_DOC_KINDS: ReadonlySet<DocumentKind> = new Set<DocumentKind>([
  "fiador",
  "conjuge_fiador",
]);

/**
 * Campos que pertencem a OUTRA modalidade e não podem sobreviver ao flip —
 * `caucao_meses` de uma caução anterior deixaria o contrato com duas garantias
 * (art. 37, § único, Lei 8.245/91) e o revisor de IA acusaria cumulação. Mesma
 * semântica de reset de `toGuaranteeData` em `api/locacao/guarantees`.
 * O valor é o "vazio" que o schema espera para o campo.
 */
export const GARANTIA_MODALIDADE_RESET: ReadonlyArray<readonly [string, unknown]> = [
  ["garantia.provider", ""],
  ["garantia.caucao_meses", undefined],
  ["garantia.cobertura_meses", undefined],
  ["garantia.seguro_tomador", undefined],
  ["garantia.seguro_vigencia", undefined],
  ["garantia.titulo_valor", undefined],
  ["garantia.titulo_proposta", ""],
];

export function shouldFlipGarantiaToFiador(kind: string, tipoAtual: unknown): boolean {
  return FIADOR_DOC_KINDS.has(kind as DocumentKind) && tipoAtual !== "fiador";
}

/** Fiador com alguma identidade preenchida (nome/razão social/CPF/CNPJ). */
export function fiadorHasIdentity(fiador: unknown): boolean {
  if (!fiador || typeof fiador !== "object") return false;
  const f = fiador as Record<string, unknown>;
  return ["nome", "razao_social", "cpf", "cnpj"].some(
    (k) => typeof f[k] === "string" && (f[k] as string).trim() !== ""
  );
}

/**
 * "Este formulário tem fiador": a modalidade é fiador OU já existe um fiador
 * identificado (um doc atribuído a ele define a modalidade). É o predicado dos
 * gates de UI que antes olhavam só `garantia.tipo` (link do fiador, painel de
 * links, recomendação de e-mail do cônjuge, quick-check de CPF).
 */
export function garantiaTemFiador(data: { garantia?: unknown } | null | undefined): boolean {
  const g = data?.garantia;
  if (!g || typeof g !== "object") return false;
  const { tipo, fiador } = g as { tipo?: unknown; fiador?: unknown };
  return tipo === "fiador" || fiadorHasIdentity(fiador);
}

/** Fiador nomeado — o mínimo para o contrato qualificá-lo no preâmbulo. */
export function fiadorHasName(fiador: unknown): boolean {
  if (!fiador || typeof fiador !== "object") return false;
  const f = fiador as Record<string, unknown>;
  const nome = f.tipo_pessoa === "juridica" ? f.razao_social : f.nome;
  return typeof nome === "string" && nome.trim() !== "";
}

/**
 * Piso do finalize e da etapa 5: com `garantia.tipo === "fiador"`, o fiador
 * precisa de nome (PF) ou razão social (PJ). Devolve o path que falta, ou null.
 * Compartilhado entre o wizard (bloqueia o avanço) e a rota de finalize (422),
 * para os dois nunca discordarem.
 */
export function missingFiadorName(data: Record<string, unknown> | null | undefined): string | null {
  const g = data?.garantia;
  if (!g || typeof g !== "object") return null;
  const { tipo, fiador } = g as { tipo?: unknown; fiador?: unknown };
  if (tipo !== "fiador") return null;
  if (fiadorHasName(fiador)) return null;
  const isPJ =
    !!fiador && typeof fiador === "object" &&
    (fiador as Record<string, unknown>).tipo_pessoa === "juridica";
  return isPJ ? "garantia.fiador.razao_social" : "garantia.fiador.nome";
}

/**
 * "A garantia passa a ser fiador (definida pelos documentos)": vira o tipo e
 * limpa a modalidade anterior. Não toca `garantia.fiador`. Retorna `true` se
 * flipou; `false` quando o tipo já era fiador (idempotente) ou o kind não é
 * de fiador.
 */
export function applyFiadorFlip(
  kind: string,
  get: (path: string) => unknown,
  set: (path: string, value: unknown) => void
): boolean {
  if (!shouldFlipGarantiaToFiador(kind, get("garantia.tipo"))) return false;
  set("garantia.tipo", "fiador");
  for (const [path, empty] of GARANTIA_MODALIDADE_RESET) {
    const current = get(path);
    if (current === undefined || current === null || current === "") continue;
    set(path, empty);
  }
  return true;
}

export const FIADOR_FLIP_TOAST = "Garantia alterada para Fiador (definida pelos documentos)";
