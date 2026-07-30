import { notFound } from "next/navigation";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { dealOrgScopeWhere, resolveUserOrgId } from "@/lib/security/org-scope";
import { DealDetail } from "@/components/pipeline/DealDetail";
import { isNewtonEnabledForDeal } from "@/lib/newton/gate";
import { getOrgModules, isFeatureEnabled } from "@/lib/modules/read";
import { surveyFeatureForKind } from "@/lib/modules/catalog";

export default async function DealPage({
  params,
}: {
  params: { dealId: string };
}) {
  const session = await auth();
  if (!session?.user) return null;

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
