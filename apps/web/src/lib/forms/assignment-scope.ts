import { resolveRolePaths } from "./role-paths";
import type { ParticipantRole } from "./participant-token";

/**
 * Validação e escopo do `assignment` de um FormAttachment ({kind, index}).
 *
 * Puro/isomórfico (sem React/DOM/Prisma) — usado tanto no cliente
 * (`readPersistedAssignment` em doc-step-adapter) quanto no servidor (PATCH
 * `/api/forms/[token]/attachments`).
 *
 * Por que isto existe: a partir da reflexão OCR (Fix 1/3), o `assignment`
 * persistido passou a ser LIDO DE VOLTA e AUTO-APLICADO no lado do admin sem
 * revisão humana. Antes era dado morto. Então ele agora precisa ser tratado
 * como entrada não-confiável:
 *   - `index` sem limite → `ensureSlot` faz `while (len <= index) push` e trava
 *     a aba (DoS). Limitamos a [0, MAX_ASSIGNMENT_INDEX].
 *   - `kind` fora do papel da parte → uma parte forjaria escrita cross-role que
 *     o auto-apply aplicaria em `vendedores`/`compradores` alheios. O servidor
 *     valida contra `ROLE_PATHS[role]`.
 */

export const DOCUMENT_KINDS = [
  "vendedor",
  "comprador",
  "conjuge_vendedor",
  "conjuge_comprador",
  "representante_vendedor",
  "representante_comprador",
  // Procurador PF de venda (subobjeto `procurador` da parte) — aditivo em
  // 2026-07-31. Documento de procuração não tinha destino antes disso.
  "procurador_vendedor",
  "procurador_comprador",
  "locador",
  "locatario",
  "fiador",
  "representante_locador",
  "representante_locatario",
  // Cônjuge de locação (o schema tem outorga uxória desde 2026-07-24, mas o
  // OCR não tinha kind pra ela).
  "conjuge_locador",
  "conjuge_locatario",
  "conjuge_fiador",
  "imovel",
  "outro",
] as const;

const KIND_SET = new Set<string>(DOCUMENT_KINDS);

/** Teto de índice de slot — nenhum negócio real tem 50 partes/imóveis. */
export const MAX_ASSIGNMENT_INDEX = 50;

export interface ParsedAssignment {
  kind: string;
  index: number;
}

/**
 * Valida o shape cru de um assignment. Retorna `{kind,index}` saneado (só esses
 * dois campos) ou `null` se inválido: kind desconhecido, index não-inteiro,
 * negativo, `NaN`/`Infinity` (que passam em `typeof === "number"`) ou > teto.
 */
export function parseAssignment(raw: unknown): ParsedAssignment | null {
  if (!raw || typeof raw !== "object") return null;
  const { kind, index } = raw as { kind?: unknown; index?: unknown };
  if (typeof kind !== "string" || !KIND_SET.has(kind)) return null;
  if (
    typeof index !== "number" ||
    !Number.isInteger(index) ||
    index < 0 ||
    index > MAX_ASSIGNMENT_INDEX
  ) {
    return null;
  }
  return { kind, index };
}

export type Esteira = "venda" | "locacao";

/**
 * Chave top-level de `dataJson` onde o kind escreve (alinhada a `ROLE_PATHS`).
 * `imovel` depende da esteira: venda usa `imoveis` (array), locação `imovel`
 * (singular). `outro` (e qualquer coisa que não escreve) → null.
 */
export function topKeyForKind(kind: string, esteira: Esteira): string | null {
  switch (kind) {
    case "vendedor":
    case "conjuge_vendedor":
    case "representante_vendedor":
    case "procurador_vendedor":
      return "vendedores";
    case "comprador":
    case "conjuge_comprador":
    case "representante_comprador":
    case "procurador_comprador":
      return "compradores";
    case "locador":
    case "representante_locador":
    case "conjuge_locador":
      return "locadores";
    case "locatario":
    case "representante_locatario":
    case "conjuge_locatario":
      return "locatarios";
    // Fiador e cônjuge do fiador vivem dentro de `garantia` (ROLE_PATHS.fiador).
    case "fiador":
    case "conjuge_fiador":
      return "garantia";
    case "imovel":
      return esteira === "locacao" ? "imovel" : "imoveis";
    default:
      return null;
  }
}

/**
 * Um assignment pertence ao papel da parte? `outro` (topKey null) sempre passa
 * (não escreve no dataJson). Usado no PATCH pra barrar subtoken forjando slot
 * de outra parte.
 */
export function assignmentAllowedForRole(
  kind: string,
  role: ParticipantRole | string,
  esteira: Esteira,
  /**
   * Escopo EFETIVO do subtoken (resolveParticipantScope — inclui a config de
   * visibilidade da org). Sem ele, cai nos defaults estáticos: correto pra
   * chamadas client-side de UX, mas o PATCH server-side deve passar o escopo
   * real — senão uma org que TIROU uma etapa do link ainda aceitaria
   * assignment naquela seção.
   */
  allowedPaths?: readonly string[],
): boolean {
  const topKey = topKeyForKind(kind, esteira);
  if (topKey === null) return true;
  if (allowedPaths) return allowedPaths.includes(topKey);
  // `resolveRolePaths` em vez de `ROLE_PATHS[role]`: role de terceiro
  // (`terceiro:<slug>`) devolve `["terceiros.<slug>"]`, que nunca casa um
  // topKey de parte — logo o terceiro só consegue anexar como `outro`. Com o
  // acesso direto ao mapa isto seria `undefined.includes` (500).
  return resolveRolePaths(role).includes(topKey);
}

/** Deriva a esteira a partir do `SalesForm.schemaType`. */
export function esteiraFromSchemaType(schemaType: string | null | undefined): Esteira {
  return schemaType?.startsWith("locacao") ? "locacao" : "venda";
}
