import { requireAnyFeaturePage } from "@/lib/modules/page-guard";
import { FEATURE } from "@/lib/modules/catalog";
import { prisma } from "@/lib/db/prisma";
import {
  SurveysListClient,
  type SurveyListRow,
} from "@/components/surveys/SurveysListClient";

export const dynamic = "force-dynamic";

export default async function PesquisasPage() {
  const { orgId } = await requireAnyFeaturePage([
    FEATURE.VENDAS_PESQUISAS,
    FEATURE.LOCACAO_PESQUISAS,
  ]);

  const templates = await prisma.surveyTemplate.findMany({
    where: { orgId, isLatest: true },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      familyId: true,
      version: true,
      name: true,
      description: true,
      status: true,
      questionsJson: true,
      createdAt: true,
      _count: { select: { invites: true, responses: true } },
    },
  });

  const versionCounts =
    templates.length > 0
      ? await prisma.surveyTemplate.groupBy({
          by: ["familyId"],
          where: { orgId, familyId: { in: templates.map((t) => t.familyId) } },
          _count: { _all: true },
        })
      : [];
  const countByFamily = new Map(versionCounts.map((g) => [g.familyId, g._count._all]));

  const rows: SurveyListRow[] = templates.map((t) => ({
    id: t.id,
    familyId: t.familyId,
    version: t.version,
    name: t.name,
    description: t.description,
    status: t.status,
    questionCount: Array.isArray(t.questionsJson) ? t.questionsJson.length : 0,
    versionCount: countByFamily.get(t.familyId) ?? 1,
    inviteCount: t._count.invites,
    responseCount: t._count.responses,
    createdAt: t.createdAt.toISOString(),
  }));

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Pesquisas de satisfação</h1>
        <p className="text-sm text-muted-foreground">
          Modelos de pesquisa NPS/CSAT enviados às partes e corretores ao longo
          do processo de venda e locação.
        </p>
      </div>
      <SurveysListClient rows={rows} />
    </div>
  );
}
