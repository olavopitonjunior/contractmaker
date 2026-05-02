/**
 * Fast, deterministic checks that run client-side or server-side without touching an LLM.
 * These filter out the easy cases so the passive analyzer only escalates to Haiku when needed.
 */

export type QuickFinding = {
  severity: "info" | "warning" | "error";
  category: "math" | "qualification" | "reference" | "format";
  message: string;
  selectedText: string;
  suggestedFix?: string;
};

type DadosPagamento = {
  valor_total?: number | string | null;
  sinal_arras?: number | string | null;
  recursos_proprios?: number | string | null;
  fgts?: number | string | null;
  cessao_consorcio?: number | string | null;
  alienacao_fiduciaria?: number | string | null;
  outras_formas?: number | string | null;
};

type DadosPessoa = {
  nome?: string | null;
  cpf?: string | null;
  cnpj?: string | null;
};

type DadosContrato = {
  pagamento?: DadosPagamento;
  vendedores?: DadosPessoa[];
  compradores?: DadosPessoa[];
};

function toNumber(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const cleaned = v.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function formatBRL(n: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
}

/**
 * Validates a Brazilian CPF using the standard checksum algorithm.
 * Returns true when the digits form a structurally valid CPF.
 */
function isValidCPF(cpf: string): boolean {
  const digits = cpf.replace(/\D/g, "");
  if (digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false;
  const calcDigit = (slice: string, factor: number): number => {
    let sum = 0;
    for (const d of slice) {
      sum += parseInt(d, 10) * factor--;
    }
    const mod = (sum * 10) % 11;
    return mod === 10 ? 0 : mod;
  };
  const d1 = calcDigit(digits.slice(0, 9), 10);
  const d2 = calcDigit(digits.slice(0, 10), 11);
  return d1 === parseInt(digits[9], 10) && d2 === parseInt(digits[10], 10);
}

/**
 * Validates a Brazilian CNPJ using the standard checksum algorithm.
 */
function isValidCNPJ(cnpj: string): boolean {
  const digits = cnpj.replace(/\D/g, "");
  if (digits.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(digits)) return false;
  const factors1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const factors2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const calc = (slice: string, factors: number[]): number => {
    let sum = 0;
    for (let i = 0; i < factors.length; i++) {
      sum += parseInt(slice[i], 10) * factors[i];
    }
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };
  const d1 = calc(digits.slice(0, 12), factors1);
  const d2 = calc(digits.slice(0, 13), factors2);
  return d1 === parseInt(digits[12], 10) && d2 === parseInt(digits[13], 10);
}

/**
 * Runs pure, deterministic checks against the contract data and HTML.
 * No IA, no network — safe to run in the browser during debounced edits.
 */
export function quickChecks(
  dataJson: unknown,
  htmlContent: string
): QuickFinding[] {
  const findings: QuickFinding[] = [];
  const data = (dataJson && typeof dataJson === "object" ? dataJson : {}) as DadosContrato;

  // --- 1. Payment sum ---
  if (data.pagamento) {
    const p = data.pagamento;
    const total = toNumber(p.valor_total);
    if (total > 0) {
      const parts = [
        toNumber(p.sinal_arras),
        toNumber(p.recursos_proprios),
        toNumber(p.fgts),
        toNumber(p.cessao_consorcio),
        toNumber(p.alienacao_fiduciaria),
        toNumber(p.outras_formas),
      ];
      const sum = parts.reduce((a, b) => a + b, 0);
      const diff = Math.abs(sum - total);
      if (diff > 0.01) {
        const missing = total - sum;
        findings.push({
          severity: "error",
          category: "math",
          message:
            missing > 0
              ? `A soma das parcelas (${formatBRL(sum)}) é menor que o valor total (${formatBRL(total)}). Faltam ${formatBRL(missing)}.`
              : `A soma das parcelas (${formatBRL(sum)}) excede o valor total (${formatBRL(total)}) em ${formatBRL(-missing)}.`,
          selectedText: formatBRL(total),
          suggestedFix:
            missing > 0
              ? `Adicionar ${formatBRL(missing)} em alguma das formas de pagamento ou reduzir o valor total.`
              : `Reduzir alguma das formas de pagamento em ${formatBRL(-missing)}.`,
        });
      }
    }
  }

  // --- 2. CPF/CNPJ structural validity ---
  const allPeople: Array<{ kind: "vendedor" | "comprador"; data: DadosPessoa; idx: number }> = [];
  (data.vendedores || []).forEach((v, idx) => allPeople.push({ kind: "vendedor", data: v, idx }));
  (data.compradores || []).forEach((v, idx) => allPeople.push({ kind: "comprador", data: v, idx }));

  for (const person of allPeople) {
    const label = `${person.kind === "vendedor" ? "Vendedor" : "Comprador"} ${person.idx + 1}`;
    if (person.data.cpf && !isValidCPF(person.data.cpf)) {
      findings.push({
        severity: "error",
        category: "qualification",
        message: `CPF de ${label} (${person.data.nome || "sem nome"}) é inválido: ${person.data.cpf}`,
        selectedText: person.data.cpf,
        suggestedFix: "Verifique o CPF junto ao titular e corrija nos dados do formulário.",
      });
    }
    if (person.data.cnpj && !isValidCNPJ(person.data.cnpj)) {
      findings.push({
        severity: "error",
        category: "qualification",
        message: `CNPJ de ${label} (${person.data.nome || "sem nome"}) é inválido: ${person.data.cnpj}`,
        selectedText: person.data.cnpj,
        suggestedFix: "Confirme o CNPJ na Receita Federal e corrija.",
      });
    }
  }

  // --- 3. Duplicate qualification: same CPF with conflicting names ---
  const cpfMap = new Map<string, Set<string>>();
  for (const person of allPeople) {
    if (person.data.cpf && person.data.nome) {
      const cpf = person.data.cpf.replace(/\D/g, "");
      if (cpf.length === 11) {
        if (!cpfMap.has(cpf)) cpfMap.set(cpf, new Set());
        cpfMap.get(cpf)!.add(person.data.nome.trim().toLowerCase());
      }
    }
  }
  for (const [cpf, names] of cpfMap) {
    if (names.size > 1) {
      findings.push({
        severity: "warning",
        category: "qualification",
        message: `O CPF ${cpf} aparece com nomes diferentes: ${Array.from(names).join(" / ")}`,
        selectedText: cpf,
      });
    }
  }

  // --- 4. Internal references that may be broken ---
  // Simple heuristic: look for "Cláusula X" references and check if a heading with matching text exists
  const referenceRegex = /Cláusula\s+([A-ZÁÊÇÕa-záêçõ]+|\d+)/g;
  const referenced = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = referenceRegex.exec(htmlContent)) !== null) {
    referenced.add(match[1].toLowerCase());
  }
  const headingRegex = /<h[1-3][^>]*>([^<]*?)<\/h[1-3]>/gi;
  const headings: string[] = [];
  let hMatch: RegExpExecArray | null;
  while ((hMatch = headingRegex.exec(htmlContent)) !== null) {
    headings.push(hMatch[1].toLowerCase());
  }
  // Basic check: if "Cláusula Décima" is referenced but no heading mentions "décima" or "10" or "décim"
  for (const ref of referenced) {
    const found = headings.some((h) => h.includes(ref) || h.includes(ref.slice(0, 4)));
    if (!found && ref.length > 2) {
      findings.push({
        severity: "info",
        category: "reference",
        message: `Referência a "Cláusula ${ref}" no texto, mas nenhuma cláusula com esse identificador foi encontrada no documento.`,
        selectedText: `Cláusula ${ref}`,
      });
    }
  }

  return findings;
}

/**
 * Determine if a set of quickChecks findings is severe enough to skip the LLM passive analysis.
 * If there are hard errors, we don't need to call the LLM — show them directly.
 */
export function shouldSkipLLM(findings: QuickFinding[]): boolean {
  return findings.some((f) => f.severity === "error");
}

/**
 * Build a deterministic dedupe key for a finding so re-analyses don't spam duplicates.
 * Uses content hash; safe in both Node and browser environments.
 *
 * IMPORTANTE: a chave NÃO inclui o `text` (mensagem da LLM) porque a frase varia
 * entre chamadas mesmo descrevendo o mesmo problema. Em produção um único finding
 * "Cláusula 9.1 vs 8.1.1" foi gerado 188× com phrasings diferentes ($1.50 desperdiçado
 * por contrato). A chave usa `authorType + category + selectedText` — mesmo trecho
 * + mesma categoria = mesma finding, regardless de como a IA escreveu a mensagem.
 */
export function dedupeKeyFor(
  authorType: string,
  category: string,
  selectedText: string
): string {
  const trecho = selectedText.trim().toLowerCase().slice(0, 200);
  const source = `${authorType}::${category}::${trecho}`;
  // Simple FNV-1a 32-bit hash — collision-resistant enough for per-contract dedupe
  let hash = 0x811c9dc5;
  for (let i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return `ai-${hash.toString(16).padStart(8, "0")}`;
}
