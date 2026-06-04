import { prisma } from "@/lib/db/prisma";
import { dealDataToSigners, leaseDataToSigners } from "@/lib/clicksign/mapping";
import { envelopeCostCents, getMonthlyBudgetCents } from "@/lib/clicksign/costs";
import { getMonthlySpendCents } from "@/lib/clicksign/executor";
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
  const authMethod: AuthMethod = args.authMethod ?? "email";

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
  const { signers, missing } =
    contract.deal?.pipeline?.kind === "locacao"
      ? leaseDataToSigners(dataSource, authMethod)
      : dealDataToSigners(dataSource, authMethod);
  if (missing.length > 0) {
    return {
      error: `Partes sem e-mail: ${missing.map((m) => m.name).join(", ")}`,
      status: 422,
    };
  }
  if (signers.length === 0) {
    return {
      error: "Nenhum signatário válido encontrado nos dados do contrato",
      status: 422,
    };
  }

  const planCost = envelopeCostCents(signers.map(() => authMethod));
  const budget = getMonthlyBudgetCents();
  const spent = await getMonthlySpendCents(args.orgId);

  return {
    summary: `Enviar envelope ClickSign com ${signers.length} signatário(s) via ${authMethod} (custo R$ ${(planCost / 100).toFixed(2)})`,
    details: {
      contractId: contract.id,
      authMethod,
      signers: signers.map((s) => ({
        name: s.name,
        email: s.email,
        role: s.sourceKind,
      })),
      planCostCents: planCost,
      monthlySpentCents: spent,
      monthlyBudgetCents: budget,
      envelopeName: args.envelopeName ?? null,
      deadlineAt: args.deadlineAt ?? null,
    },
  };
}
