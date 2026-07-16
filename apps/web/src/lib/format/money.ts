/**
 * Parsing monetário robusto BR/US — fonte única de verdade.
 *
 * Os parsers antigos (`parseNumber` em asaas/commission, `toNumber` em
 * quickChecks/memory/dimob e o inline de NovaPropostaDialog) faziam
 * `replace(/\./g, "")` INCONDICIONAL — removiam todo ponto ANTES de checar se
 * havia vírgula. Resultado: "1000.00" → 100000 (100×), "1.5" → 15. Isso
 * inflava comissão, valor de cobrança e valor de proposta. Aqui o ponto só é
 * tratado como separador de milhar quando há vírgula (decimal BR) OU quando
 * claramente agrupa milhares (ponto com 3+ dígitos / múltiplos pontos).
 *
 * Regras:
 *   "1.500.000,00" → 1500000     (vírgula = decimal; pontos = milhar)
 *   "850000,50"    → 850000.5
 *   "850.000"      → 850000       (ponto agrupando milhar)
 *   "1000.00"      → 1000         (ponto decimal US, ≤2 dígitos após)
 *   "1.5"          → 1.5          (ponto decimal, ≤2 dígitos após)
 *   "R$ 850.000"   → 850000
 */
export function parseMoneyBR(raw: unknown): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  if (typeof raw !== "string") return 0;

  // Remove tudo que não é dígito, vírgula, ponto ou sinal.
  const cleaned = raw.replace(/[^\d.,-]/g, "");
  if (!cleaned) return 0;

  const negative = cleaned.trimStart().startsWith("-");
  const digits = cleaned.replace(/-/g, "");

  let result: number;
  if (digits.includes(",")) {
    // Vírgula presente → é o decimal; pontos são milhar.
    const lastComma = digits.lastIndexOf(",");
    const integerPart = digits.slice(0, lastComma).replace(/[.,]/g, "");
    const decimalPart = digits.slice(lastComma + 1).replace(/[.,]/g, "");
    result = parseFloat(`${integerPart || "0"}.${decimalPart || "0"}`);
  } else {
    // Sem vírgula: um único ponto com 1-2 dígitos após = decimal; senão milhar.
    const dotCount = (digits.match(/\./g) || []).length;
    if (dotCount === 1) {
      const afterDot = digits.split(".")[1] ?? "";
      if (afterDot.length >= 1 && afterDot.length <= 2) {
        result = parseFloat(digits);
      } else {
        result = parseFloat(digits.replace(/\./g, ""));
      }
    } else {
      result = parseFloat(digits.replace(/\./g, ""));
    }
  }

  if (Number.isNaN(result)) return 0;
  return negative ? -result : result;
}
