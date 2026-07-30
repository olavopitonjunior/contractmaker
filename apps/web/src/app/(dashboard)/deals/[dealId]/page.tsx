import { notFound } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { getEffectiveUserId } from "@/lib/auth/impersonation";
import { prisma } from "@/lib/db/prisma";
import { DealDetail } from "@/components/pipeline/DealDetail";
import { isNewtonEnabledForDeal } from "@/lib/newton/gate";
import { getOrgModules, isFeatureEnabled } from "@/lib/modules/read";
import { surveyFeatureForKind } from "@/lib/modules/catalog";
import { getEffectivePermissions, canAccessDeal } from "@/lib/security/rbac/check";

export default async function DealPage({
  params,
}: {
  params: { dealId: string };
}) {
  const session = await auth();
  if (!session?.user?.id) return null;
  const org = await getUserOrg(session.user.id);
  if (!org) notFound();

  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
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
      envelopes: {
        where: { source: "contract", status: "closed", contract: { kind: "contract" } },
        select: { closedAt: true },
        orderBy: { closedAt: "desc" },
        take: 1,
      },
      commissionCharges: {
        select: { createdAt: true },
        orderBy: { createdAt: "asc" },
        take: 1,
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

  return (
    <DealDetail
      deal={deal}
      newtonEnabled={newtonEnabled}
      surveysEnabled={surveysEnabled}
    />
  );
}
