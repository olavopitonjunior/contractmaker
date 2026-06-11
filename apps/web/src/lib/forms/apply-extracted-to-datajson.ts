import type { UseFormReturn } from "react-hook-form";
import {
  mapExtractedToForm,
  type Assignment,
} from "@/lib/forms/extracted-to-form";
import { mapExtractedToLocacaoForm } from "@/lib/forms/extracted-to-form-locacao";

/**
 * Server-safe autofill: aplica o resultado de OCR de um documento sobre o
 * `dataJson` de um SalesForm (shape do form público: vendedores[], compradores[],
 * imoveis[], etc), reaproveitando INTEGRALMENTE a lógica de `mapExtractedToForm`.
 *
 * Em vez de duplicar os field-maps/heurísticas, montamos um adaptador mínimo que
 * implementa só os dois métodos que `mapExtractedToForm` usa — `getValues(path)`
 * e `setValue(path, value)` — sobre um objeto plano clonado. RHF usa paths
 * pontilhados com índices numéricos (`vendedores.0.cpf`, `vendedores.0.conjuge.nome`),
 * então `getByPath`/`setByPath` tratam segmentos numéricos como índices de array.
 *
 * Não muta o `dataJson` original. Respeita `skipIfDirty` (default true): campos
 * já preenchidos não são sobrescritos.
 */

type PlainObject = Record<string, unknown>;

function isIndex(seg: string): boolean {
  return /^\d+$/.test(seg);
}

function getByPath(root: PlainObject, path: string): unknown {
  const segs = path.split(".");
  let cur: unknown = root;
  for (const seg of segs) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as PlainObject)[seg];
  }
  return cur;
}

function setByPath(root: PlainObject, path: string, value: unknown): void {
  const segs = path.split(".");
  let cur: PlainObject | unknown[] = root;
  for (let i = 0; i < segs.length - 1; i++) {
    const seg = segs[i];
    const nextIsIndex = isIndex(segs[i + 1]);
    const container = cur as PlainObject & Record<string, unknown>;
    let child = (container as PlainObject)[seg];
    if (child == null || typeof child !== "object") {
      child = nextIsIndex ? [] : {};
      (container as PlainObject)[seg] = child;
    }
    cur = child as PlainObject | unknown[];
  }
  (cur as PlainObject)[segs[segs.length - 1]] = value;
}

interface ApplyResult {
  merged: PlainObject;
  filled: number;
}

export function applyExtractedToDataJson(
  dataJson: PlainObject | null | undefined,
  extraction: { category: string | null; fields: Record<string, unknown> | null },
  assignment: Assignment,
  options: { skipIfDirty?: boolean; kind?: "venda" | "locacao" } = {}
): ApplyResult {
  // Clone profundo simples — o input é JSON puro vindo do DB.
  const merged: PlainObject = dataJson
    ? (JSON.parse(JSON.stringify(dataJson)) as PlainObject)
    : {};

  const formAdapter = {
    getValues: (path?: string) => (path ? getByPath(merged, path) : merged),
    setValue: (path: string, value: unknown) => setByPath(merged, path, value),
  } as unknown as UseFormReturn<Record<string, unknown>>;

  // Locação tem basePaths próprios (locadores.{i}/locatarios.{i}/garantia.fiador/
  // imovel singular) — o mapper de venda devolveria filled=0 sempre.
  const mapper =
    options.kind === "locacao" ? mapExtractedToLocacaoForm : mapExtractedToForm;
  const filled = mapper(
    { category: extraction.category, fields: extraction.fields ?? {} },
    assignment,
    formAdapter,
    { skipIfDirty: options.skipIfDirty ?? true }
  );

  return { merged, filled };
}
