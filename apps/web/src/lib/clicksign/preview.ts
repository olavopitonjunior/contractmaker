import { prisma } from "@/lib/db/prisma";
import { dealDataToSigners, leaseDataToSigners } from "@/lib/clicksign/mapping";
import { moduleForDealKind, pipelineKind } from "@/lib/modules/resolve";
import { MODULE } from "@/lib/modules/catalog";
import { envelopeCostCents, getMonthlyBudgetCents } from "@/lib/clicksign/costs";
import { getMonthlySpendCents, mergeDefaultWitnesses } from "@/lib/clicksign/executor";
import { getSignatureSettings } from "@/lib/clicksign/account";
import type { AuthMethod } from "@/lib/clicksign/types";

/**
 * Preview da operação `ENVELOPE_SEND` — usado em ActionIntent quando Bearer
 * dispara envio. Calcula signers, custo, budget restante SEM fazer chamadas
 * Clicksign (apenas leituras DB).
 */

export interface EnvelopeSendPreview {
  summary: string;
  details: {
    contractId: string;
    authMethod: AuthMethod;
    signers: Array<{
      name: string;
      email: string | null;
      role: string;
    }>;
    planCostCents: number;
    monthlySpentCents: number;
    monthlyBudgetCents: number;
    envelopeName: string | null;
    deadlineAt: string | null;
  };
}

export async function buildEnvelopeSendPreview(args: {
  contractId: string;
  orgId: string;
  authMethod?: AuthMethod;
  envelopeName?: string;
  deadlineAt?: string | null;
}): Promise<EnvelopeSendPreview | { error: string; status: number }> {
  const settings = await getSignatureSettings(args.orgId);
  const authMethod: AuthMethod =
    args.authMethod ?? (settings.defaultAuthMethod as AuthMethod);

  const contract = await prisma.contract.findFirst({
    where: { id: args.contractId, deal: { pipeline: { orgId: args.orgId } } },
    select: {
      id: true,
      status: true,
      dataJson: true,
      deal: { select: { pipeline: { select: { kind: true } } } },
    },
  });
  if (!contract) {
    return { error: "Contrato não encontrado", status: 404 };
  }
  if (contract.status !== "aprovado") {
    return {
      error: "Contrato precisa estar aprovado antes de enviar para assinatura",
      status: 400,
    };
  }

  const dataSource =
    (contract.dataJson as Record<string, unknown> | null) ?? null;
  const { signers: derived, missing, dropped } =
    moduleForDealKind(contract.deal?.pipeline?.kind) === MODULE.LOCACAO
      ? leaseDataToSigners(dataSource, authMethod)
      : dealDataToSigners(dataSource, authMethod);
  if (missing.length > 0) {
    return {
      error: `Partes sem e-mail: ${missing.map((m) => m.name).join(", ")}`,
      status: 422,
    };
  }
  // Preview do caminho DERIVADO (Bearer/Newton): reflete as testemunhas padrão
  // do scope do módulo que o servidor vai injetar no envio real.
  const signers = await mergeDefaultWitnesses(
    args.orgId,
    derived.map((s) => ({
      name: s.name,
      email: s.email,
      documentation: s.documentation,
      phone: s.phone,
      sourceKind: s.sourceKind,
      sourceIndex: s.sourceIndex,
      subKind: s.subKind,
    })),
    pipelineKind(moduleForDealKind(contract.deal?.pipeline?.kind))
  );
  if (signers.length === 0) {
    return {
      error: "Nenhum signatário válido encontrado nos dados do contrato",
      status: 422,
    };
  }

  const overrides = settings.costOverridesJson as Record<string, unknown> | null;
  const planCost = envelopeCostCents(
    signers.map(() => authMethod),
    overrides
  );
  const budget = getMonthlyBudgetCents(settings.monthlyBudgetCents);
  const spent = await getMonthlySpendCents(args.orgId);

  // Descartes por e-mail repetido não podem passar em silêncio: quem sai da
  // lista continua com linha de assinatura no PDF, e quem aprova o envio
  // precisa ver isso antes de confirmar.
  const droppedNote =
    dropped.length > 0
      ? ` Não entram por e-mail repetido: ${dropped.map((d) => d.name).join(", ")}.`
      : "";

  return {
    summary: `Enviar envelope ClickSign com ${signers.length} signatário(s) via ${authMethod} (custo R$ ${(planCost / 100).toFixed(2)}).${droppedNote}`,
    details: {
      contractId: contract.id,
      authMethod,
      signers: signers.map((s) => ({
        name: s.name,
        email: s.email ?? null,
        role: s.sourceKind ?? "outro",
      })),
      planCostCents: planCost,
      monthlySpentCents: spent,
      monthlyBudgetCents: budget,
      envelopeName: args.envelopeName ?? null,
      deadlineAt: args.deadlineAt ?? null,
    },
  };
}
