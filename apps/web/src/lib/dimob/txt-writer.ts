/**
 * Serializador do arquivo TXT da DIMOB, 100% dirigido pela tabela de `layout.ts`.
 *
 * Nenhuma posição de byte é hardcoded aqui — toda a geometria vem dos
 * `DimobRecordLayout`. Trocar/consertar o leiaute = editar só `layout.ts`.
 *
 * ⚠️ O leiaute é PROVISÓRIO até validação contra o PGD DIMOB real (ver layout.ts).
 */

import {
  DIMOB_LINE_SEPARATOR,
  type DimobField,
  type DimobRecordLayout,
} from "./layout";

/** Valor bruto aceito por campo (o writer normaliza conforme o tipo). */
export type DimobValue = string | number | Date | null | undefined;

export type DimobRecordValues = Record<string, DimobValue>;

export interface DimobRecordInput {
  layout: DimobRecordLayout;
  values: DimobRecordValues;
}

/** Remove acentos, força maiúsculas e mantém só ASCII imprimível básico. */
export function sanitizeText(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // diacríticos
    .toUpperCase()
    .replace(/[^A-Z0-9 .,\-/&]/g, " ") // conjunto seguro p/ importador
    .replace(/\s+/g, " ")
    .trim();
}

function onlyDigits(input: string): string {
  return input.replace(/\D/g, "");
}

function padRight(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len) : s + " ".repeat(len - s.length);
}

function padLeftZero(s: string, len: number): string {
  return s.length >= len ? s.slice(-len) : "0".repeat(len - s.length) + s;
}

/** Converte diferentes entradas de data para DDMMYYYY (ou "" se indeterminável). */
export function toDdmmyyyy(value: DimobValue): string {
  if (value == null || value === "") return "";
  if (value instanceof Date) {
    const d = String(value.getUTCDate()).padStart(2, "0");
    const m = String(value.getUTCMonth() + 1).padStart(2, "0");
    const y = String(value.getUTCFullYear()).padStart(4, "0");
    return `${d}${m}${y}`;
  }
  const s = String(value).trim();
  // ISO YYYY-MM-DD (ou YYYY-MM-DDT...)
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}${iso[2]}${iso[1]}`;
  // BR DD/MM/YYYY
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[1]}${br[2]}${br[3]}`;
  // Já em DDMMYYYY
  if (/^\d{8}$/.test(s)) return s;
  return "";
}

/**
 * Formata um único campo, devolvendo string de exatamente `field.length`.
 * `money` espera o valor em REAIS (number) e grava em centavos, 2 decimais
 * implícitas.
 */
export function formatField(field: DimobField, value: DimobValue): string {
  const len = field.length;

  switch (field.type) {
    case "const":
      return padRight(field.literal ?? "", len);

    case "reserved":
      return " ".repeat(len);

    case "text": {
      const s = value == null ? "" : sanitizeText(String(value));
      return padRight(s, len);
    }

    case "num": {
      const digits = value == null ? "" : onlyDigits(String(value));
      return padLeftZero(digits, len);
    }

    case "doc": {
      const digits = value == null ? "" : onlyDigits(String(value));
      return padLeftZero(digits, len);
    }

    case "year": {
      const digits = value == null ? "" : onlyDigits(String(value));
      return padLeftZero(digits, len);
    }

    case "date": {
      const dd = toDdmmyyyy(value);
      // vazio => zeros (importador DIMOB rejeita espaço em campo de data numérica)
      return dd ? padLeftZero(dd, len) : "0".repeat(len);
    }

    case "money": {
      const reais =
        typeof value === "number"
          ? value
          : value == null || value === ""
            ? 0
            : Number(String(value).replace(",", "."));
      const cents = Number.isFinite(reais) ? Math.round(reais * 100) : 0;
      return padLeftZero(String(Math.max(0, cents)), len);
    }

    default:
      return " ".repeat(len);
  }
}

/**
 * Verifica que os campos de um layout são contíguos, não se sobrepõem e cabem
 * no `totalLength`. Serve de guarda em dev/teste — um leiaute inconsistente é
 * bug de programação, não de dado.
 */
export function assertLayoutIntegrity(layout: DimobRecordLayout): void {
  const sorted = [...layout.fields].sort((a, b) => a.start - b.start);
  let cursor = 1;
  for (const f of sorted) {
    if (f.start !== cursor) {
      throw new Error(
        `Layout ${layout.record}: campo "${f.key}" começa em ${f.start}, esperado ${cursor} (gap/overlap).`
      );
    }
    cursor = f.start + f.length;
  }
  const end = cursor - 1;
  if (end !== layout.totalLength) {
    throw new Error(
      `Layout ${layout.record}: soma dos campos = ${end}, mas totalLength = ${layout.totalLength}.`
    );
  }
}

/** Serializa uma linha (registro) do arquivo. */
export function serializeRecord(input: DimobRecordInput): string {
  const { layout, values } = input;
  const buf: string[] = new Array(layout.totalLength).fill(" ");

  for (const field of layout.fields) {
    const raw = field.type === "const" ? field.literal : values[field.key];
    const formatted = formatField(field, raw);
    if (formatted.length !== field.length) {
      throw new Error(
        `Campo "${field.key}" (${layout.record}) formatado com ${formatted.length} != ${field.length}.`
      );
    }
    for (let i = 0; i < field.length; i++) {
      buf[field.start - 1 + i] = formatted[i];
    }
  }

  const line = buf.join("");
  if (line.length !== layout.totalLength) {
    throw new Error(
      `Registro ${layout.record} gerado com ${line.length} != ${layout.totalLength}.`
    );
  }
  return line;
}

/**
 * Monta o arquivo TXT completo: uma linha por registro, separadas por CRLF,
 * com CRLF final (esperado pelo importador).
 */
export function buildDimobFile(records: DimobRecordInput[]): string {
  const lines = records.map(serializeRecord);
  return lines.join(DIMOB_LINE_SEPARATOR) + DIMOB_LINE_SEPARATOR;
}
