/**
 * Heurística pra calcular o vencimento default de uma cobrança de comissão
 * com base nos sinais do contrato (`comissao.quando_paga`,
 * `comissao.prazo_dias_apos_marco`, `modalidade`).
 *
 * Quando o contrato não diz nada explícito, escolhe um marco razoável por
 * modalidade. Sempre cai no próximo dia útil (a Asaas faz isso de qualquer
 * jeito; resolver aqui evita susto na UI do corretor).
 */

import { checkBusinessDay } from "@/lib/financeiro/businessDay";

export interface DueDateContext {
  modalidade?: "a_vista" | "financiamento";
  comissao?: {
    quando_paga?: string; // assinatura | chaves | quitacao | registro | parcelas | ...
    prazo_dias_apos_marco?: number;
  };
}

export interface ResolvedDueDate {
  /** YYYY-MM-DD */
  iso: string;
  /** Texto pra UI explicando como chegou nesta data */
  reason: string;
}

const DEFAULT_DAYS_BY_MARK: Record<string, number> = {
  assinatura: 3,
  chaves: 30,
  quitacao: 30,
  registro: 60,
  parcelas: 7,
};

function addDaysISO(today: Date, days: number): string {
  const d = new Date(today);
  d.setUTCDate(d.getUTCDate() + days);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function shiftToBusinessDay(iso: string): string {
  const check = checkBusinessDay(iso);
  if (check.isBusinessDay) return iso;
  return check.adjustedToISO ?? iso;
}

export function resolveDefaultDueDate(
  data: DueDateContext,
  today: Date = new Date()
): ResolvedDueDate {
  const explicit = data.comissao?.prazo_dias_apos_marco;
  const marco = (data.comissao?.quando_paga ?? "").toLowerCase();

  // 1) Override explícito do contrato
  if (typeof explicit === "number" && explicit > 0) {
    const iso = shiftToBusinessDay(addDaysISO(today, explicit));
    return {
      iso,
      reason: `${explicit} dias após ${marco || "hoje"} (configurado no contrato)`,
    };
  }

  // 2) Heurística por marco
  if (marco && DEFAULT_DAYS_BY_MARK[marco]) {
    const days = DEFAULT_DAYS_BY_MARK[marco];
    const iso = shiftToBusinessDay(addDaysISO(today, days));
    const labels: Record<string, string> = {
      assinatura: "assinatura",
      chaves: "entrega das chaves",
      quitacao: "quitação",
      registro: "registro da escritura",
      parcelas: "1ª parcela",
    };
    return {
      iso,
      reason: `${days} dias após ${labels[marco] ?? marco}`,
    };
  }

  // 3) Heurística por modalidade
  if (data.modalidade === "financiamento") {
    const iso = shiftToBusinessDay(addDaysISO(today, 60));
    return { iso, reason: "60 dias (estimativa pós-registro do financiamento)" };
  }

  // 4) Fallback histórico
  const iso = shiftToBusinessDay(addDaysISO(today, 7));
  return { iso, reason: "7 dias (padrão)" };
}
