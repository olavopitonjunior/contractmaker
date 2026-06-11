import type { UseFormReturn } from "react-hook-form";
import type { SelectGroup } from "@/components/forms/NativeSelect";
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
    applyFicha: (fields, form, options) =>
      applyFichaResumo(fields, form as never, options),
  };
}
