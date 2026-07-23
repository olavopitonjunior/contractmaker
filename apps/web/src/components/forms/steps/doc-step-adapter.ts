import type { UseFormReturn } from "react-hook-form";
import type { SelectGroup, SelectOption } from "@/components/forms/NativeSelect";
import type { DocumentCardData } from "@/components/forms/DocumentCard";
import {
  applyFichaResumo,
  mapExtractedToForm,
  suggestAssignment,
  type Assignment,
  type DocumentKind,
  type ExtractedDoc,
  type FichaResumoData,
  type ProcessedDocHint,
} from "@/lib/forms/extracted-to-form";
import { parseAssignment } from "@/lib/forms/assignment-scope";

/**
 * Valida o shape de `extractedData.assignment` persistido (PATCH em handleApply)
 * antes de confiar nele como assignment do card (Fix 1: reflexão da escolha da
 * parte no restore). Doc antigo pode não ter o campo → retorna null.
 *
 * Delega a `parseAssignment`: além de checar `{kind,index}`, valida `kind`
 * contra o conjunto conhecido e limita `index` a [0, MAX] — o assignment agora
 * é auto-aplicado (Fix 3), então índice gigante travaria o `ensureSlot`.
 */
export function readPersistedAssignment(extracted: unknown): Assignment | null {
  if (!extracted || typeof extracted !== "object") return null;
  const parsed = parseAssignment((extracted as { assignment?: unknown }).assignment);
  return parsed ? { kind: parsed.kind as DocumentKind, index: parsed.index } : null;
}

/**
 * Pontos role-shaped da etapa 0 (DocumentosStep) — tudo que depende do shape
 * do form (vendedores/compradores/imoveis em venda; locadores/locatarios/
 * imovel singular em locação) vive atrás deste adapter. O encanamento de
 * upload/polling/OCR é compartilhado e não muda por esteira.
 */
export interface DocumentosStepAdapter {
  /** Sugere o slot de um doc recém-extraído (match CPF/nome no snapshot). */
  suggest(
    category: string | null,
    fields: Record<string, unknown>,
    snapshot: Record<string, unknown>,
    siblings?: ProcessedDocHint[]
  ): Assignment;
  /** Aplica os campos extraídos no form (autofill). Retorna nº de campos. */
  apply(
    extraction: ExtractedDoc,
    assignment: Assignment,
    form: UseFormReturn<Record<string, unknown>>,
    options?: { skipIfDirty?: boolean }
  ): number;
  /** Opções do dropdown "Atribuir a…" agrupadas por papel. */
  buildOptions(
    snapshot: Record<string, unknown>,
    docs: DocumentCardData[]
  ): SelectGroup[];
  /**
   * Array RHF que precisa crescer pro kind caber em `index` (auto-grow e
   * "+ Novo"). null = kind não é array (subobjeto/objeto singular) — RHF cria
   * o path no primeiro setValue.
   */
  fieldKeyForKind(
    kind: DocumentKind
  ): { key: string; emptyItem: Record<string, unknown> } | null;
  /** Rótulo humano do kind (toast do "+ Novo"). */
  kindLabel(kind: DocumentKind): string;
  /**
   * Chave top-level de `dataJson` (alinhada a `ROLE_PATHS`) onde o kind escreve
   * — usada pra escopar os slots de atribuição por papel nos links por parte
   * (`/f/p/[subtoken]`). `null` = kind não escreve no `dataJson` (ex.: `outro`),
   * então nunca é filtrado. NÃO reusar `fieldKeyForKind` aqui: ele retorna null
   * pra `imovel`/`fiador` (não-arrays), que precisam entrar no escopo.
   */
  topKeyForKind(kind: DocumentKind): string | null;
  /**
   * Aplica uma ficha-resumo no form (mestra de classificação, Fase E).
   * Ausente = esteira sem suporte a ficha (locação) — docs ficam em "outro".
   */
  applyFicha?: (
    fields: FichaResumoData,
    form: UseFormReturn<Record<string, unknown>>,
    options: { skipIfDirty?: boolean }
  ) => number;
}

// ============================================================================
// Adapter default — VENDA. Encapsula o comportamento histórico da etapa 0;
// as funções vivem em lib/forms/extracted-to-form.ts e o buildOptions é
// injetado pelo próprio DocumentosStep (precisa do slotName local).
// ============================================================================

const VENDA_KIND_LABELS: Partial<Record<DocumentKind, string>> = {
  vendedor: "Vendedor",
  comprador: "Comprador",
  imovel: "Imóvel",
};

export function createVendaAdapter(
  buildOptions: DocumentosStepAdapter["buildOptions"]
): DocumentosStepAdapter {
  return {
    suggest: (category, fields, snapshot, siblings = []) =>
      suggestAssignment(category, fields, snapshot, siblings),
    apply: (extraction, assignment, form, options) =>
      mapExtractedToForm(extraction, assignment, form, options),
    buildOptions,
    fieldKeyForKind(kind) {
      if (kind === "imovel") return { key: "imoveis", emptyItem: {} };
      if (
        kind === "vendedor" ||
        kind === "conjuge_vendedor" ||
        kind === "representante_vendedor"
      ) {
        return { key: "vendedores", emptyItem: { tipo_pessoa: "fisica" } };
      }
      if (
        kind === "comprador" ||
        kind === "conjuge_comprador" ||
        kind === "representante_comprador"
      ) {
        return { key: "compradores", emptyItem: { tipo_pessoa: "fisica" } };
      }
      return null;
    },
    kindLabel: (kind) => VENDA_KIND_LABELS[kind] ?? kind,
    topKeyForKind: vendaTopKeyForKind,
    applyFicha: (fields, form, options) =>
      applyFichaResumo(fields, form as never, options),
  };
}

/** Mapeia o kind de venda pra chave top-level de `dataJson` (ver ROLE_PATHS). */
export function vendaTopKeyForKind(kind: DocumentKind): string | null {
  switch (kind) {
    case "vendedor":
    case "conjuge_vendedor":
    case "representante_vendedor":
      return "vendedores";
    case "comprador":
    case "conjuge_comprador":
    case "representante_comprador":
      return "compradores";
    case "imovel":
      return "imoveis";
    default:
      // `outro` (e qualquer kind de locação, que não ocorre aqui) não escreve
      // no dataJson de venda — nunca filtra.
      return null;
  }
}

/**
 * Filtra os grupos de atribuição pra só oferecer slots cuja chave top-level
 * pertence ao papel (`allowedTopKeys` = `ROLE_PATHS[role]`). Usado nos links por
 * parte pra a pessoa não conseguir atribuir um doc a um slot fora do seu escopo
 * (o autofill seria descartado no save). `allowedTopKeys` undefined (token
 * principal) → retorna os grupos intactos. Opções cujo `topKeyForKind` é `null`
 * (ex.: "Outros") sempre passam. Grupos que ficam vazios são removidos.
 */
export function filterAssignmentOptionsByScope(
  groups: SelectGroup[],
  allowedTopKeys: readonly string[] | undefined,
  topKeyForKind: (kind: DocumentKind) => string | null
): SelectGroup[] {
  if (!allowedTopKeys) return groups;
  const allow = new Set(allowedTopKeys);
  const inScope = (opt: SelectOption): boolean => {
    // value = `${kind}:${index}` | `${kind}:new`
    const kind = opt.value.split(":")[0] as DocumentKind;
    const topKey = topKeyForKind(kind);
    return topKey === null || allow.has(topKey);
  };
  return groups
    .map((g) => ({ ...g, options: g.options.filter(inScope) }))
    .filter((g) => g.options.length > 0);
}
