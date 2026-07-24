import { requireAnyFeaturePage } from "@/lib/modules/page-guard";
import { FEATURE } from "@/lib/modules/catalog";
import { prisma } from "@/lib/db/prisma";
import { parseTemplateQuestions } from "@/lib/surveys/types";
import {
  SurveyBuilder,
  type SurveyBuilderInitial,
} from "@/components/surveys/SurveyBuilder";

export const dynamic = "force-dynamic";

export default async function NovaPesquisaPage({
  searchParams,
}: {
  searchParams: { fromVersion?: string };
}) {
  const { orgId } = await requireAnyFeaturePage([
    FEATURE.VENDAS_PESQUISAS,
    FEATURE.LOCACAO_PESQUISAS,
  ]);

  let initial: SurveyBuilderInitial | undefined;
  if (searchParams.fromVersion) {
    const source = await prisma.surveyTemplate.findFirst({
      where: { id: searchParams.fromVersion, orgId },
    });
    if (source) {
      const settings = (source.settingsJson ?? {}) as { thankYouMessage?: string };
      initial = {
        fromVersionId: source.id,
        name: source.name,
        description: source.description ?? undefined,
        questions: parseTemplateQuestions(source.questionsJson),
        thankYouMessage: settings.thankYouMessage,
      };
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">
          {initial ? "Nova versão da pesquisa" : "Nova pesquisa"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {initial
            ? "As perguntas podem ser alteradas — o resultado é um novo lote com relatório zerado."
            : "Monte as perguntas; após criar, a pesquisa fica imutável (lote de relatório)."}
        </p>
      </div>
      <SurveyBuilder initial={initial} />
    </div>
  );
}
