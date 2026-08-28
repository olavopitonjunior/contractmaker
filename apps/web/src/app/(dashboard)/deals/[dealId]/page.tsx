import { notFound } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { getEffectiveUserId } from "@/lib/auth/impersonation";
import { prisma } from "@/lib/db/prisma";
import { dealOrgScopeWhere, resolveUserOrgId } from "@/lib/security/org-scope";
import { DealDetail } from "@/components/pipeline/DealDetail";
import { buildConsolidatedFormSummary } from "@/lib/forms/form-summary";
import { isNewtonEnabledForDeal } from "@/lib/newton/gate";
import { getOrgModules, isFeatureEnabled } from "@/lib/modules/read";
import { surveyFeatureForKind } from "@/lib/modules/catalog";
import { getEffectivePermissions, canAccessDeal } from "@/lib/security/rbac/check";
import { DEAL_MILESTONE_INCLUDE } from "@/lib/pipeline/deal-dates";

export default async function DealPage({
  params,
}: {
  params: { dealId: string };
}) {
  const session = await auth();
  if (!session?.user?.id) return null;
  const org = await getUserOrg(session.user.id);
  if (!org) notFound();

  // Guard cross-org na query — o DealDetail de VENDAS tinha o mesmo buraco do
  // editor de contrato (a page de locação já filtrava por pipeline.orgId).
  const orgId = await resolveUserOrgId(session.user.id);
  if (!orgId) notFound();

  const deal = await prisma.deal.findFirst({
    where: dealOrgScopeWhere(params.dealId, orgId),
    include: {
      // Deal não tem orgId direto — o escopo vem do pipeline.
      pipeline: { select: { orgId: true } },
      stage: true,
      form: {
        include: {
          attachments: { orderBy: { createdAt: "asc" } },
        },
      },
      attachments: { orderBy: { createdAt: "desc" } },
      contracts: {
        // Só o instrumento principal — sem isto, aditamentos (kind="addendum")
        // e o contrato de administração de locação (kind="administracao")
        // apareciam como "versões" do contrato na aba Contratos.
        where: { kind: "contract" },
        include: { template: { select: { name: true } } },
        orderBy: { version: "desc" },
      },
      certidaoJobs: { orderBy: { createdAt: "desc" }, take: 1 },
      ...DEAL_MILESTONE_INCLUDE,
      // Proposta de origem (conversão) — chip "Origem: proposta" no header.
      fromProposal: {
        select: {
          id: true,
          title: true,
          convertedWithoutSignature: true,
        },
      },
    },
  });

  if (!deal) notFound();

  // Cross-org + escopo por usuário (feature Gerente). A page renderiza o
  // dossiê COMPLETO (dataJson com PII, anexos, contratos) — sem este gate o
  // filtro do kanban era só cosmético: bastava a URL. 404 pra não vazar
  // existência. Espelha o GET de /api/pipeline/deals/[dealId].
  if (deal.pipeline.orgId !== org.id) notFound();
  const effUserId = await getEffectiveUserId(session.user.id);
  const eff = await getEffectivePermissions(effUserId, org.id);
  if (
    !eff ||
    !canAccessDeal({
      effective: eff,
      ownerUserId: deal.userId,
      managerUserId: deal.managerUserId,
    })
  ) {
    notFound();
  }

  const [newtonEnabled, modulesView] = await Promise.all([
    isNewtonEnabledForDeal(deal.pipeline.orgId, deal.kind),
    getOrgModules(deal.pipeline.orgId),
  ]);
  const surveysEnabled = isFeatureEnabled(
    modulesView,
    surveyFeatureForKind(deal.kind)
  );

  // Mesmas seções que vão pro PDF/e-mail do resumo (builder puro). Sem isto a
  // aba Dados mostrava um recorte manual bem menor que o do PDF — etapa de
  // posse/título, observações e configuração contratual não apareciam.
  const formSummarySections = buildConsolidatedFormSummary(
    (deal.form?.dataJson as Record<string, unknown> | null) ?? null,
    {
      schemaType: deal.form?.schemaType ?? null,
      attachments: (deal.form?.attachments ?? []).map((a) => ({
        filename: a.filename,
        category: a.category,
      })),
    }
  );

  return (
    <DealDetail
      formSummarySections={formSummarySections}
      deal={deal}
      newtonEnabled={newtonEnabled}
      surveysEnabled={surveysEnabled}
    />
  );
}
