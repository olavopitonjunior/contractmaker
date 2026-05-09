/**
 * Validações puras por etapa do ChargeWizard. Sem side-effects.
 * UI chama via POST /commission-charges/validate?step=... pra mostrar
 * warnings/erros antes do submit final.
 */

import { composeSplits, CommissionBuildError, type SplitInputEntry, type SplitDisplay } from "@/lib/asaas/commission";

export interface ValidationResult {
  ok: boolean;
  warnings: string[];
  errors: string[];
}

function emptyResult(): ValidationResult {
  return { ok: true, warnings: [], errors: [] };
}

function isValidCpfCnpj(doc: string): boolean {
  const d = doc.replace(/\D/g, "");
  return d.length === 11 || d.length === 14;
}

export interface PayerInput {
  nome?: string;
  cpfCnpj?: string;
  email?: string | null;
  mobilePhone?: string | null;
  billingType?: "PIX" | "BOLETO";
}

export function validatePayer(input: PayerInput): ValidationResult {
  const r = emptyResult();
  if (!input.nome || input.nome.trim().length < 2) {
    r.errors.push("Nome do pagador obrigatório");
  }
  if (!input.cpfCnpj || !isValidCpfCnpj(input.cpfCnpj)) {
    r.errors.push("CPF/CNPJ do pagador inválido");
  }
  if (!input.email && input.billingType === "PIX") {
    r.warnings.push("Pagador sem email — Asaas não enviará PIX por email automaticamente");
  }
  if (r.errors.length > 0) r.ok = false;
  return r;
}

export interface ChargeInput {
  billingType?: "PIX" | "BOLETO";
  value?: number;
  dueDate?: string;
}

export function validateCharge(input: ChargeInput): ValidationResult {
  const r = emptyResult();
  if (!input.value || input.value <= 0) r.errors.push("Valor deve ser positivo");
  if (!input.dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) {
    r.errors.push("Data de vencimento obrigatória (YYYY-MM-DD)");
  } else {
    const due = new Date(input.dueDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (due.getTime() < today.getTime()) {
      r.errors.push("Vencimento não pode ser no passado");
    }
  }
  if (input.billingType !== "PIX" && input.billingType !== "BOLETO") {
    r.errors.push("Forma de pagamento obrigatória");
  }
  if (r.errors.length > 0) r.ok = false;
  return r;
}

export interface SplitsInput {
  customSplits?: SplitInputEntry[];
  display?: SplitDisplay;
  platformFeePercent?: number;
  platformWalletId?: string | null;
  orgWalletId?: string;
}

export function validateSplits(input: SplitsInput): ValidationResult {
  const r = emptyResult();
  if (!input.customSplits || input.customSplits.length === 0) {
    r.warnings.push("Sem splits — todo valor cai na subconta da org");
    return r;
  }
  if (!input.orgWalletId) {
    r.errors.push("orgWalletId obrigatório para validar splits");
    r.ok = false;
    return r;
  }
  try {
    composeSplits({
      customSplits: input.customSplits,
      platformFeePercent: input.platformFeePercent,
      platformWalletId: input.platformWalletId,
      orgWalletId: input.orgWalletId,
    });
  } catch (err) {
    if (err instanceof CommissionBuildError) {
      r.errors.push(err.message);
      r.ok = false;
      return r;
    }
    r.errors.push(err instanceof Error ? err.message : "Erro desconhecido nos splits");
    r.ok = false;
    return r;
  }

  if (input.display) {
    const visibleKeys = new Set(
      input.customSplits
        .filter((s) => {
          const id = s.recipientId ??
            (s.recipientType === "asaas_wallet" ? s.walletId : s.pixAddressKey);
          return !input.display!.hiddenRecipientIds.includes(id);
        })
        .map((s) =>
          s.recipientId ??
          (s.recipientType === "asaas_wallet" ? s.walletId : s.pixAddressKey)
        )
    );
    for (const [hidden, target] of Object.entries(input.display.consolidationMap)) {
      if (!visibleKeys.has(target)) {
        r.errors.push(`Split oculto ${hidden} aponta para destino ${target} que não é visível`);
      }
      void hidden;
    }
    if (visibleKeys.size === 0 && input.display.hiddenRecipientIds.length > 0) {
      r.warnings.push(
        "Todos os splits estão ocultos — pagador verá apenas dealTitle/categoryLabel na descrição"
      );
    }
  }

  if (r.errors.length > 0) r.ok = false;
  return r;
}
