/**
 * Decodifica um registro do TXT da DIMOB em células rotuladas (campo → valor +
 * posição + fatia bruta). É a ponte entre o arquivo de largura fixa (opaco) e a
 * grade de revisão/edição na UI.
 *
 * Dirigido 100% por `layout.ts` — trocar o leiaute reflete aqui automaticamente.
 * O usuário edita `value` (valor lógico); o app re-serializa via `txt-writer`.
 */

import type { DimobFieldType, DimobRecordLayout } from "./layout";
import { formatField } from "./txt-writer";
import type { DimobValue } from "./txt-writer";

export interface DecodedCell {
  key: string;
  label: string;
  /** 1-based inclusivo. */
  start: number;
  end: number;
  length: number;
  type: DimobFieldType;
  required: boolean;
  /** Valor lógico como string (editável). const/reserved => literal/vazio. */
  value: string;
  /** Fatia exata de largura fixa que este campo ocupa na linha. */
  rawSlice: string;
  /** Campos técnicos (const/reserved) não são editáveis pelo usuário. */
  editable: boolean;
}

export interface DecodedRecord {
  record: string;
  totalLength: number;
  cells: DecodedCell[];
  /** A linha bruta completa (soma das fatias). */
  raw: string;
}

const NON_EDITABLE: DimobFieldType[] = ["const", "reserved"];

export function decodeRecord(
  layout: DimobRecordLayout,
  values: Record<string, DimobValue>
): DecodedRecord {
  const cells: DecodedCell[] = layout.fields.map((f) => {
    const raw = f.type === "const" ? f.literal : values[f.key];
    const rawSlice = formatField(f, raw ?? "");
    return {
      key: f.key,
      label: f.label,
      start: f.start,
      end: f.start + f.length - 1,
      length: f.length,
      type: f.type,
      required: Boolean(f.required),
      value: raw == null ? "" : String(raw),
      rawSlice,
      editable: !NON_EDITABLE.includes(f.type),
    };
  });

  return {
    record: layout.record,
    totalLength: layout.totalLength,
    cells,
    raw: cells.map((c) => c.rawSlice).join(""),
  };
}

/**
 * Régua de colunas para exibir sob a linha bruta: marca a cada 10 posições o
 * número da posição (alinhado à direita do bloco de 10). Ex.: "........10........20".
 * Puro e testável; a UI só renderiza em <pre> monospace.
 */
export function buildColumnRuler(totalLength: number): string {
  const chars: string[] = new Array(totalLength).fill(".");
  for (let pos = 10; pos <= totalLength; pos += 10) {
    const label = String(pos);
    // alinha o número terminando na posição `pos` (1-based) => índice pos-1
    for (let i = 0; i < label.length; i++) {
      const idx = pos - label.length + i;
      if (idx >= 0 && idx < totalLength) chars[idx] = label[i];
    }
  }
  return chars.join("");
}
