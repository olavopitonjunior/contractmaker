/**
 * Parsing monetário robusto BR/US — fonte única de verdade.
 *
 * Os parsers antigos (`parseNumber` em asaas/commission, `toNumber` em
 * quickChecks/memory/dimob e o inline do diálogo de proposta) faziam
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
    // Sem vírgula: distinguir decimal (US ou percentual) de milhar (BR).
    const dotCount = (digits.match(/\./g) || []).length;
    if (dotCount === 1) {
      const [before, afterDot = ""] = digits.split(".");
      if (afterDot.length <= 2) {
        // 1-2 dígitos após o ponto = decimal ("1000.00", "6.5").
        result = parseFloat(digits);
      } else if (/^[1-9]\d{0,2}$/.test(before)) {
        // Exatamente um grupo de milhar válido antes do ponto (1-3 dígitos, sem
        // zero à esquerda) e 3+ depois = separador de milhar BR ("1.500",
        // "999.500"→999500). Um "0.750" (percentual) ou "1234.567" (4 dígitos
        // antes, típico de decimal US) NÃO casa → cai no decimal abaixo.
        result = parseFloat(digits.replace(/\./g, ""));
      } else {
        result = parseFloat(digits);
      }
    } else {
      // Múltiplos pontos = milhares BR ("1.234.567").
      result = parseFloat(digits.replace(/\./g, ""));
    }
  }

  if (Number.isNaN(result)) return 0;
  return negative ? -result : result;
}

/**
 * Parse de PERCENTUAL (0-100). Ao contrário de valor monetário, porcentagem
 * NUNCA usa separador de milhar — então ponto E vírgula são sempre decimais.
 * "6.500" e "6,500" e "6.5" e "6,5" → 6.5. Sem isto, parseMoneyBR trataria
 * "6.500" como 6500 (milhar) e a comissão sairia ~1000× o valor pretendido.
 */
export function parsePercentBR(raw: unknown): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  if (typeof raw !== "string") return 0;
  const s = raw.replace(/[^\d.,-]/g, "");
  if (!s) return 0;
  const negative = s.trimStart().startsWith("-");
  const d = s.replace(/-/g, "");
  // O último separador (ponto ou vírgula) é o decimal; os demais são ruído.
  const lastSep = Math.max(d.lastIndexOf(","), d.lastIndexOf("."));
  let n: number;
  if (lastSep === -1) {
    n = parseFloat(d);
  } else {
    const intPart = d.slice(0, lastSep).replace(/[.,]/g, "");
    const decPart = d.slice(lastSep + 1).replace(/[.,]/g, "");
    n = parseFloat(`${intPart || "0"}.${decPart || "0"}`);
  }
  if (Number.isNaN(n)) return 0;
  return negative ? -n : n;
}

/**
 * Formata valor monetário em pt-BR ("R$ 1.500,00"). Determinístico de
 * propósito: `toLocaleString("pt-BR", { style: "currency" })` intercala um
 * espaço não-quebrável que difere entre o ICU do Node e o do browser e quebra
 * a hidratação do React. Aceita número ou string (usa parseMoneyBR).
 */
export function formatMoneyBR(raw: unknown): string {
  const n = parseMoneyBR(raw);
  const [int, dec] = Math.abs(n).toFixed(2).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${n < 0 ? "-" : ""}R$ ${grouped},${dec}`;
}
