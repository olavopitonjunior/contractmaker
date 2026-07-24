import { requireAnyFeaturePage } from "@/lib/modules/page-guard";
import { FEATURE } from "@/lib/modules/catalog";
import { prisma } from "@/lib/db/prisma";
import { buildSurveyReport } from "@/lib/surveys/report";
import { SurveyReportClient } from "@/components/surveys/SurveyReportClient";

export const dynamic = "force-dynamic";

// Relatórios por LOTE: cada versão do template tem relatório próprio; o
// seletor escolhe família + versão. Estado na URL (?family=&lote=).
export default async function RelatoriosPesquisasPage({
  searchParams,
}: {
  searchParams: { family?: string; lote?: string };
}) {
  const { orgId } = await requireAnyFeaturePage([
    FEATURE.VENDAS_PESQUISAS,
    FEATURE.LOCACAO_PESQUISAS,
  ]);

  // Famílias (versão isLatest dá o nome atual) + todas as versões de cada uma.
  const allVersions = await prisma.surveyTemplate.findMany({
    where: { orgId },
    orderBy: [{ familyId: "asc" }, { version: "desc" }],
    select: {
      id: true,
      familyId: true,
      version: true,
      isLatest: true,
      name: true,
      status: true,
      createdAt: true,
      _count: { select: { responses: true } },
    },
  });

  const families = new Map<
    string,
    { familyId: string; name: string; versions: typeof allVersions }
  >();
  for (const v of allVersions) {
    const entry = families.get(v.familyId);
    if (entry) {
      entry.versions.push(v);
      if (v.isLatest) entry.name = v.name;
    } else {
      families.set(v.familyId, { familyId: v.familyId, name: v.name, versions: [v] });
    }
  }
  const familyList = Array.from(families.values());

  const selectedFamily =
    familyList.find((f) => f.familyId === searchParams.family) ?? familyList[0];
  const selectedLote =
    selectedFamily?.versions.find((v) => v.id === searchParams.lote) ??
    selectedFamily?.versions.find((v) => v.isLatest) ??
    selectedFamily?.versions[0];

  const report = selectedLote
    ? await buildSurveyReport(orgId, selectedLote.id)
    : null;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Relatórios de pesquisas</h1>
        <p className="text-sm text-muted-foreground">
          Cada versão da pesquisa é um lote com relatório próprio — lotes não se
          consolidam. Selecione a pesquisa e a versão que quer ver.
        </p>
      </div>
      <SurveyReportClient
        families={familyList.map((f) => ({
          familyId: f.familyId,
          name: f.name,
          versions: f.versions.map((v) => ({
            id: v.id,
            version: v.version,
            isLatest: v.isLatest,
            status: v.status,
            responseCount: v._count.responses,
            createdAt: v.createdAt.toISOString(),
          })),
        }))}
        selectedFamilyId={selectedFamily?.familyId ?? null}
        selectedLoteId={selectedLote?.id ?? null}
        report={report}
      />
    </div>
  );
}
