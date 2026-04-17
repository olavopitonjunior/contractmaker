import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { planCertidoesForDeal } from "@/lib/certidoes/planner";
import { runBatch, getMonthlySpend } from "@/lib/certidoes/executor";
import { endpointInfo } from "@/lib/certidoes/endpoints";
import { sanitizePayload } from "@/lib/certidoes/infosimples";
import { checkGovBrAuth } from "@/lib/certidoes/govbr-auth";
import { z } from "zod";

export const runtime = "nodejs";
export const maxDuration = 660;

/**
 * Phase C — Consulta ad-hoc de certidões para CPF/CNPJ não arrolado em Deal.
 *
 * Cenários de uso:
 *   - Diligência de um sócio da PJ compradora (não é parte direta)
 *   - Verificar fiador, testemunha, terceiro-interveniente
 *   - Consulta avulsa para prospect antes de criar Deal
 *
 * Diferenças vs. /api/deals/:dealId/certidoes:
 *   - dealId null (ad-hoc), orgId obrigatório para escopo/budget
 *   - Sem DealAttachment — PDF fica em site_receipts[0] do resultData
 *   - Share budget com batches de Deal (mesmo INFOSIMPLES_MONTHLY_BUDGET_CENTS)
 *
 * Body:
 *   {
 *     batchId: string,
 *     target: { tipoPessoa: "fisica"|"juridica", nome, cpf?, cnpj?,
 *               dataNascimento?, uf?, cidade? },
 *     endpointIds: string[]   // explicit endpoint selection; empty = default plan
 *   }
 */
const targetSchema = z.object({
  tipoPessoa: z.enum(["fisica", "juridica"]),
  nome: z.string().min(1),
  cpf: z.string().optional().nullable(),
  cnpj: z.string().optional().nullable(),
  dataNascimento: z.string().optional().nullable(),
  uf: z.string().length(2).optional().nullable(),
  cidade: z.string().optional().nullable(),
});

const adhocSchema = z.object({
  batchId: z.string().min(8),
  target: targetSchema,
  endpointIds: z.array(z.string()).min(1).max(20),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = adhocSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { batchId, target, endpointIds } = parsed.data;

  // Budget guard (mesmo budget compartilhado com Deals — quota da org)
  const spend = await getMonthlySpend(org.id);
  if (spend.exceeded) {
    return NextResponse.json(
      { error: "Budget mensal de certidoes atingido", spend },
      { status: 402 }
    );
  }

  // Phase F.II-γ — pre-flight GOV.BR
  const govbr = await checkGovBrAuth();

  // Usa o planner existente como diligenciado — trata o target ad-hoc como
  // uma pessoa diligenciada, que o planner já sabe processar.
  const plan = planCertidoesForDeal(
    {},
    undefined,
    [
      {
        tipoPessoa: target.tipoPessoa,
        nome: target.nome,
        cpf: target.cpf,
        cnpj: target.cnpj,
        dataNascimento: target.dataNascimento,
        uf: target.uf,
        cidade: target.cidade,
      },
    ],
    { expandAll: true, govBrActive: govbr.active }
  );

  // Filtra pelos endpoints pedidos pelo usuário.
  const requested = new Set(endpointIds);
  const effectiveJobs = plan.jobs.filter((j) => requested.has(j.endpoint));
  const effectiveSkipped = plan.skipped.filter((s) =>
    requested.has(s.endpoint)
  );

  if (effectiveJobs.length === 0 && effectiveSkipped.length === 0) {
    return NextResponse.json(
      {
        error:
          "Nenhum endpoint compatível com o target informado. Verifique se CPF/CNPJ e data de nascimento estão preenchidos para o tipo de consulta.",
        availableEndpoints: plan.jobs.map((j) => j.endpoint),
      },
      { status: 400 }
    );
  }

  const totalCostCents = effectiveJobs.reduce((acc, j) => acc + j.costCents, 0);
  if (spend.spentCents + totalCostCents > spend.budgetCents) {
    return NextResponse.json(
      {
        error: "Este lote estouraria o budget mensal de certidoes",
        spend,
        totalCostCents,
      },
      { status: 402 }
    );
  }

  // Cria os job rows. Sem dealId (ad-hoc) — só orgId + userId.
  await prisma.$transaction([
    ...effectiveJobs.map((p) => {
      const info = endpointInfo(p.endpoint);
      return prisma.certidaoJob.create({
        data: {
          dealId: null,
          orgId: org.id,
          userId: session.user.id,
          batchId,
          endpoint: p.endpoint,
          label: p.label,
          targetKind: p.targetKind, // sempre "diligenciado" para ad-hoc
          targetIndex: p.targetIndex,
          requestPayload: sanitizePayload(p.requestPayload) as object,
          status: info.initialStatus ?? "pending",
          costCents: null,
        },
      });
    }),
    ...effectiveSkipped.map((s) =>
      prisma.certidaoJob.create({
        data: {
          dealId: null,
          orgId: org.id,
          userId: session.user.id,
          batchId,
          endpoint: s.endpoint,
          label: s.label,
          targetKind: s.targetKind,
          targetIndex: s.targetIndex,
          requestPayload: {
            missingField: s.missingField,
            missingFields: s.missingFields,
          } as object,
          status: "skipped",
          errorMessage: s.reason,
          costCents: 0,
        },
      })
    ),
  ]);

  // Fire-and-forget — runBatch aceita dealId null (Phase C).
  void runBatch(batchId, null).catch((err) => {
    console.error("[certidoes adhoc] runBatch failed", err);
  });

  return NextResponse.json(
    {
      batchId,
      jobCount: effectiveJobs.length,
      skipped: effectiveSkipped,
      totalCostCents,
    },
    { status: 202 }
  );
}

/**
 * GET /api/certidoes/adhoc?batchId=xxx
 * Lists ad-hoc jobs for the caller's org. Polled by the UI.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const batchId = searchParams.get("batchId");

  const jobs = await prisma.certidaoJob.findMany({
    where: {
      orgId: org.id,
      dealId: null,
      ...(batchId ? { batchId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: batchId ? 100 : 50,
  });

  return NextResponse.json({
    jobs,
    latestBatchId: jobs[0]?.batchId,
  });
}
