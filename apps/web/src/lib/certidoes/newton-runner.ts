import { prisma } from "@/lib/db/prisma";
import { planCertidoesForDeal } from "@/lib/certidoes/planner";
import { runBatch, getMonthlySpend } from "@/lib/certidoes/executor";
import { endpointInfo } from "@/lib/certidoes/endpoints";
import { sanitizePayload } from "@/lib/certidoes/infosimples";
import { checkGovBrAuth } from "@/lib/certidoes/govbr-auth";

interface RunCertidoesArgs {
  dealId: string;
  orgId: string;
  userId: string;
  batchId: string;
}

interface RunResult {
  status: number;
  body: {
    batchId?: string;
    jobCount?: number;
    skipped?: unknown[];
    totalCostCents?: number;
    error?: string;
  };
}

/**
 * Inline runner do batch de certidões. Compartilhado entre o endpoint
 * Newton-bearer (`/api/deals/[dealId]/certidoes-newton`) e o executor de
 * `CERTIDAO_REQUEST` em `lib/api/intent-executors/index.ts`.
 *
 * Re-roda planner + budget guard a cada chamada (estado pode mudar entre
 * criação da intent e aprovação humana).
 *
 * Versão simplificada do `/api/deals/[dealId]/certidoes` POST original: só
 * suporta auto plan (sem `selectedJobs`). Adicionar parâmetro conforme
 * Newton precisar.
 */
export async function runCertidoesBatchInline(
  args: RunCertidoesArgs
): Promise<RunResult> {
  const { dealId, orgId, userId, batchId } = args;

  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: { form: { select: { dataJson: true, orgId: true } } },
  });
  if (!deal) {
    return { status: 404, body: { error: "Deal not found" } };
  }

  const spend = await getMonthlySpend(orgId);
  if (spend.exceeded) {
    return {
      status: 402,
      body: { error: "Budget mensal de certidões atingido" },
    };
  }

  const dealData =
    (deal.form?.dataJson as Record<string, unknown> | null) ??
    (deal.dataJson as Record<string, unknown> | null);

  const diligenciadosRaw = await prisma.diligentedPerson.findMany({
    where: { dealId },
    orderBy: { createdAt: "asc" },
  });
  const diligenciados = diligenciadosRaw.map((d) => ({
    id: d.id,
    tipoPessoa: d.tipoPessoa as "fisica" | "juridica",
    nome: d.nome,
    cpf: d.cpf,
    cnpj: d.cnpj,
    dataNascimento: d.dataNascimento,
    uf: d.uf,
    cidade: d.cidade,
  }));

  const govbr = await checkGovBrAuth();
  const plan = planCertidoesForDeal(dealData as never, undefined, diligenciados, {
    expandAll: false,
    govBrActive: govbr.active,
  });

  if (plan.jobs.length === 0 && plan.skipped.length === 0) {
    return { status: 400, body: { error: "Nada para extrair" } };
  }

  const totalCostCents = plan.jobs.reduce((acc, j) => acc + j.costCents, 0);
  if (spend.spentCents + totalCostCents > spend.budgetCents) {
    return {
      status: 402,
      body: { error: "Este lote estouraria o budget mensal" },
    };
  }

  await prisma.$transaction([
    ...plan.jobs.map((p) => {
      const info = endpointInfo(p.endpoint);
      return prisma.certidaoJob.create({
        data: {
          dealId,
          userId,
          batchId,
          endpoint: p.endpoint,
          label: p.label,
          targetKind: p.targetKind,
          targetIndex: p.targetIndex,
          requestPayload: sanitizePayload(p.requestPayload) as object,
          status: info.initialStatus ?? "pending",
          costCents: null,
          portalUrl: info.portalUrl ?? null,
        },
      });
    }),
    ...plan.skipped.map((s) => {
      let portalUrl: string | null = s.externalLink ?? null;
      try {
        portalUrl = endpointInfo(s.endpoint).portalUrl ?? portalUrl;
      } catch {
        /* sem catálogo */
      }
      return prisma.certidaoJob.create({
        data: {
          dealId,
          userId,
          batchId,
          endpoint: s.endpoint,
          label: s.label,
          targetKind: s.targetKind,
          targetIndex: s.targetIndex,
          requestPayload: {
            missingField: s.missingField,
            missingFields: s.missingFields,
            ...(s.externalLink ? { externalLink: s.externalLink } : {}),
          } as object,
          status: "skipped",
          errorMessage: s.reason,
          costCents: 0,
          missingFields: s.missingFields?.length
            ? s.missingFields.map((mf) => mf.path)
            : s.missingField
            ? [s.missingField]
            : [],
          portalUrl,
        },
      });
    }),
  ]);

  void runBatch(batchId, dealId).catch((err) => {
    console.error("[certidoes-newton] runBatch failed", err);
  });

  return {
    status: 202,
    body: {
      batchId,
      jobCount: plan.jobs.length,
      skipped: plan.skipped,
      totalCostCents,
    },
  };
}
