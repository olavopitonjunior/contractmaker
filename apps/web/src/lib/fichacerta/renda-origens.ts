/**
 * Tabela "origem da renda" da Ficha Certa (renda.principal.origem e
 * renda.outra.origem) — copiada da doc em 04/09/2026. O código 10 não existe
 * na tabela deles. Client-safe (usada no select do editor de pretendentes).
 */
export const RENDA_ORIGENS: ReadonlyArray<{ code: number; label: string }> = [
  { code: 1, label: "Origem não informada" },
  { code: 2, label: "Funcionário público (estatutário)" },
  { code: 3, label: "Funcionário público (CLT)" },
  { code: 4, label: "Empresário" },
  { code: 5, label: "Profissional liberal ou autônomo" },
  { code: 6, label: "Aposentado / pensionista" },
  { code: 7, label: "Renda de aluguel" },
  { code: 8, label: "Pensão alimentícia ou judicial" },
  { code: 9, label: "Estagiário / bolsista" },
  { code: 11, label: "Registrado por empresa ou pessoa física (CLT)" },
  { code: 12, label: "Militar" },
  { code: 13, label: "Limite de cartão de crédito" },
  { code: 14, label: "Outro" },
  { code: 15, label: "Movimentação bancária (extratos)" },
  { code: 16, label: "Não possui renda" },
];

const BY_CODE = new Map(RENDA_ORIGENS.map((o) => [o.code, o.label]));

export function rendaOrigemLabel(code: number | string | null | undefined): string | null {
  const n = typeof code === "string" ? Number.parseInt(code, 10) : code;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return BY_CODE.get(n) ?? null;
}

export function isRendaOrigem(code: unknown): code is number {
  return typeof code === "number" && BY_CODE.has(code);
}
