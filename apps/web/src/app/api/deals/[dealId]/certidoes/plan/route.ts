import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { planCertidoesForDeal } from "@/lib/certidoes/planner";
import { getMonthlySpend } from "@/lib/certidoes/executor";
import {
  listAllForPicker,
  listCoveredUfs,
  listCoveredCategories,
  CATEGORY_LABELS,
} from "@/lib/certidoes/catalog";

export const runtime = "nodejs";

/**
 * GET /api/deals/:dealId/certidoes/plan
 * GET /api/deals/:dealId/certidoes/plan?full=1
 *
 * Default: returns the auto-plan + current monthly spend. Used by the
 * ExtractCertidoesDialog's initial load to decide what to suggest.
 *
 * With `full=1`: also returns the complete endpoint catalog (for the
 * "+ Adicionar outras" picker) AND the expanded plan (with expandAll=true)
 * so the picker can show which extras are ALREADY buildable for each target
 * without requiring extra client-side logic.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    include: { form: { select: { orgId: true, dataJson: true } } },
  });
  if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  if (deal.form && deal.form.orgId !== org.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const dealData =
    (deal.form?.dataJson as Record<string, unknown> | null) ||
    (deal.dataJson as Record<string, unknown> | null);

  // F3: load diligenciados so they appear in the plan
  const diligenciadosRaw = await prisma.diligentedPerson.findMany({
    where: { dealId: params.dealId },
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

  const { searchParams } = new URL(req.url);
  const full = searchParams.get("full") === "1";

  const plan = planCertidoesForDeal(dealData as any, undefined, diligenciados);
  const spend = await getMonthlySpend(org.id);

  if (!full) {
    return NextResponse.json({ plan, spend, diligenciados: diligenciadosRaw });
  }

  // F1/F2: include the full catalog and the expanded plan so the picker can
  // render the "+ Adicionar outras" affordance with accurate payload data.
  const expandedPlan = planCertidoesForDeal(
    dealData as any,
    undefined,
    diligenciados,
    { expandAll: true }
  );
  const catalog = listAllForPicker();

  return NextResponse.json({
    plan,
    expandedPlan,
    spend,
    diligenciados: diligenciadosRaw,
    catalog,
    catalogMeta: {
      ufs: listCoveredUfs(),
      categories: listCoveredCategories().map((c) => ({
        id: c,
        label: CATEGORY_LABELS[c],
      })),
    },
  });
}
