function onlyDigits(input: string): string {
  return (input ?? "").replace(/\D/g, "");
}

/**
 * Normaliza telefone BR pra E.164 (+55DDNNNNNNNNN).
 * Aceita 10 (fixo) ou 11 (celular) dígitos sem DDI, ou 12-13 com DDI 55.
 * Retorna null se não bater o formato.
 */
export function normalizeBrPhone(raw: string): string | null {
  if (!raw) return null;
  let d = onlyDigits(raw);
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) {
    d = d.slice(2);
  }
  if (d.length !== 10 && d.length !== 11) return null;
  return `+55${d}`;
}

export function formatBrPhone(raw: string): string {
  const e164 = normalizeBrPhone(raw);
  if (!e164) return raw;
  const d = e164.slice(3);
  if (d.length === 11) {
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7, 11)}`;
  }
  return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6, 10)}`;
}
