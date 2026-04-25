/**
 * Cálculo de taxas, overprice, descontos, multa e juros.
 *
 * Funções PURAS — sem side-effects, sem HTTP. Usadas tanto no server (para
 * compor payload Asaas) quanto no client (para preview ao vivo do editor
 * de taxas).
 */

export type BillingType = "PIX" | "BOLETO" | "CREDIT_CARD";

export type OverpricePolicy = "none" | "absorb" | "asaas_fee" | "custom";

export type RoundingMode = "cents" | "real_up" | "real_down";

export type DiscountPresetType = "PERCENTAGE" | "FIXED";

export interface DiscountPreset {
  id: string;
  label: string;
  type: DiscountPresetType;
  value: number;
  /**
   * Quantos dias antes do vencimento o desconto ainda é válido.
   * Negativo ou zero. Ex: -3 = até 3 dias antes. 0 = até o próprio vencimento.
   */
  dueDayOffset: number;
}

export type PixSplitFeePolicy = "org_absorbs" | "deduct_from_recipient";

export interface FeesSettings {
  platformFeePercent: number;
  platformFeeWalletId: string | null;
  overpricePolicy: OverpricePolicy;
  overpriceType?: "percentage" | "fixed" | null;
  overpriceValue?: number | null;
  overpriceRoundTo: RoundingMode;
  discountPresets: DiscountPreset[];
  finePercent: number;
  interestPercentMonth: number;
  asaasFeePixCents: number;
  asaasFeeBoletoCents: number;
  asaasFeeCardPercent: number;
  asaasFeeCardCents: number;
  pixSplitFeePolicy: PixSplitFeePolicy;
}

export const DEFAULT_FEES_SETTINGS: FeesSettings = {
  platformFeePercent: 0,
  platformFeeWalletId: null,
  overpricePolicy: "none",
  overpriceType: null,
  overpriceValue: null,
  overpriceRoundTo: "cents",
  discountPresets: [],
  finePercent: 2.0,
  interestPercentMonth: 1.0,
  asaasFeePixCents: 199,
  asaasFeeBoletoCents: 349,
  asaasFeeCardPercent: 2.99,
  asaasFeeCardCents: 49,
  pixSplitFeePolicy: "org_absorbs",
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function applyRounding(n: number, mode: RoundingMode): number {
  if (mode === "cents") return round2(n);
  if (mode === "real_up") return Math.ceil(n);
  if (mode === "real_down") return Math.floor(n);
  return round2(n);
}

export function computeAsaasFee(
  billingType: BillingType,
  grossValue: number,
  settings: FeesSettings
): number {
  if (billingType === "PIX") return settings.asaasFeePixCents / 100;
  if (billingType === "BOLETO") return settings.asaasFeeBoletoCents / 100;
  if (billingType === "CREDIT_CARD") {
    return round2(
      grossValue * (settings.asaasFeeCardPercent / 100) +
        settings.asaasFeeCardCents / 100
    );
  }
  return 0;
}

export function computeOverpriceAmount(
  nominalValue: number,
  billingType: BillingType,
  settings: FeesSettings
): number {
  switch (settings.overpricePolicy) {
    case "none":
    case "absorb":
      return 0;
    case "asaas_fee":
      return computeAsaasFee(billingType, nominalValue, settings);
    case "custom": {
      if (!settings.overpriceType || !settings.overpriceValue) return 0;
      if (settings.overpriceType === "percentage") {
        return round2((nominalValue * settings.overpriceValue) / 100);
      }
      return round2(settings.overpriceValue);
    }
    default:
      return 0;
  }
}

export interface FeePreview {
  nominalValue: number;
  overpriceAmount: number;
  grossValue: number;
  asaasFeeEstimate: number;
  netValueEstimate: number;
  platformFeeAmount: number;
  orgReceives: number;
  discount?: {
    label: string;
    type: DiscountPresetType;
    value: number;
    amount: number;
    validUntil: Date;
  };
  fineAmount: number;
  interestPerDay: number;
}

export interface PreviewInput {
  nominalValue: number;
  billingType: BillingType;
  settings: FeesSettings;
  discountPresetId?: string | null;
  dueDate: Date | string;
}

export function previewCharge(input: PreviewInput): FeePreview {
  const { nominalValue, billingType, settings } = input;
  const overpriceAmount = computeOverpriceAmount(
    nominalValue,
    billingType,
    settings
  );

  const grossRaw = nominalValue + overpriceAmount;
  const grossValue = applyRounding(grossRaw, settings.overpriceRoundTo);

  const asaasFeeEstimate = computeAsaasFee(billingType, grossValue, settings);
  const netValueEstimate = round2(grossValue - asaasFeeEstimate);

  const platformFeeAmount = round2(
    netValueEstimate * (settings.platformFeePercent / 100)
  );
  const orgReceives = round2(netValueEstimate - platformFeeAmount);

  // Multa + juros (se vencer)
  const fineAmount = round2((grossValue * settings.finePercent) / 100);
  const interestPerDay = round2(
    (grossValue * (settings.interestPercentMonth / 100)) / 30
  );

  // Discount preset
  let discount: FeePreview["discount"];
  if (input.discountPresetId) {
    const preset = settings.discountPresets.find(
      (p) => p.id === input.discountPresetId
    );
    if (preset) {
      const amount =
        preset.type === "PERCENTAGE"
          ? round2((grossValue * preset.value) / 100)
          : round2(preset.value);
      const due = new Date(input.dueDate);
      const validUntil = new Date(due);
      validUntil.setDate(validUntil.getDate() + preset.dueDayOffset);
      discount = {
        label: preset.label,
        type: preset.type,
        value: preset.value,
        amount,
        validUntil,
      };
    }
  }

  return {
    nominalValue: round2(nominalValue),
    overpriceAmount: round2(overpriceAmount),
    grossValue,
    asaasFeeEstimate,
    netValueEstimate,
    platformFeeAmount,
    orgReceives,
    discount,
    fineAmount,
    interestPerDay,
  };
}

// Helpers para construir objetos que vão para o Asaas payment body

export function buildAsaasDiscountObj(
  preset: DiscountPreset | null | undefined
): { value: number; dueDateLimitDays?: number; type: DiscountPresetType } | undefined {
  if (!preset) return undefined;
  return {
    value: preset.value,
    dueDateLimitDays: Math.abs(preset.dueDayOffset),
    type: preset.type,
  };
}

export function buildAsaasFineObj(settings: FeesSettings) {
  if (!settings.finePercent) return undefined;
  return { value: settings.finePercent, type: "PERCENTAGE" as const };
}

export function buildAsaasInterestObj(settings: FeesSettings) {
  if (!settings.interestPercentMonth) return undefined;
  return {
    value: settings.interestPercentMonth,
    type: "PERCENTAGE" as const,
  };
}

// Zod-less validators (para uso em forms client-side)
export function validateFeesSettings(partial: Partial<FeesSettings>): string[] {
  const errors: string[] = [];
  if (
    partial.platformFeePercent !== undefined &&
    (partial.platformFeePercent < 0 || partial.platformFeePercent > 10)
  ) {
    errors.push("Taxa de repasse deve estar entre 0% e 10%");
  }
  if (
    partial.finePercent !== undefined &&
    (partial.finePercent < 0 || partial.finePercent > 2)
  ) {
    errors.push("Multa deve estar entre 0% e 2% (limite legal CDC)");
  }
  if (
    partial.interestPercentMonth !== undefined &&
    (partial.interestPercentMonth < 0 || partial.interestPercentMonth > 1)
  ) {
    errors.push("Juros ao mês deve estar entre 0% e 1% (limite legal CDC)");
  }
  if (partial.overpricePolicy === "custom") {
    if (!partial.overpriceType) errors.push("overpriceType obrigatório quando custom");
    if (!partial.overpriceValue || partial.overpriceValue <= 0) {
      errors.push("overpriceValue deve ser positivo quando custom");
    }
  }
  return errors;
}
