import { notFound } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { getEffectiveUserId } from "@/lib/auth/impersonation";
import { prisma } from "@/lib/db/prisma";
import { dealOrgScopeWhere, resolveUserOrgId } from "@/lib/security/org-scope";
import { DealDetail } from "@/components/pipeline/DealDetail";
import { buildConsolidatedFormSummary } from "@/lib/forms/form-summary";
import { isNewtonEnabledForDeal } from "@/lib/newton/gate";
import { getOrgModules, isFeatureEnabled } from "@/lib/modules/read";
import { FEATURE, surveyFeatureForKind } from "@/lib/modules/catalog";
import { hasSuperlogicaAccount, superlogicaVendaUrl } from "@/lib/superlogica/account";
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
      // Exportação para a Superlógica (badge + desabilita a cobrança Asaas).
      superlogicaExport: { select: { status: true, vendaId: true } },
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
  // Superlógica: feature ligada na org E conta gravada — só então o botão
  // "Enviar para Superlógica" aparece na aba Pagamentos (venda). Checagem
  // SEM decifrar tokens: um decrypt que falhe (chave rotacionada) não pode
  // derrubar a página de todos os negócios de venda da org.
  const superlogicaEnabled =
    deal.kind === "venda" &&
    isFeatureEnabled(modulesView, FEATURE.VENDAS_SUPERLOGICA) &&
    (await hasSuperlogicaAccount(deal.pipeline.orgId));
  // URL da venda derivada no server (fonte única em account.ts).
  const superlogicaExport = deal.superlogicaExport
    ? {
        status: deal.superlogicaExport.status,
        vendaId: deal.superlogicaExport.vendaId,
        url: deal.superlogicaExport.vendaId ? superlogicaVendaUrl(deal.superlogicaExport.vendaId) : null,
      }
    : null;

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
      deal={{ ...deal, superlogicaExport }}
      newtonEnabled={newtonEnabled}
      surveysEnabled={surveysEnabled}
      superlogicaEnabled={superlogicaEnabled}
    />
  );
}
