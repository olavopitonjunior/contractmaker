import { prisma } from "@/lib/db/prisma";
import { resolveSurveyToken } from "@/lib/surveys/token";
import { parseTemplateQuestions } from "@/lib/surveys/types";
import { getOrgBrand } from "@/lib/tenant/branding";
import { SurveyPublicClient } from "@/components/surveys/SurveyPublicClient";
import { CheckCircle2, Link2Off } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pesquisa de satisfação" };

function CenterCard({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-md rounded-xl border bg-background p-8 text-center shadow-xs">
        {children}
      </div>
    </main>
  );
}

export default async function SurveyPublicPage({
  params,
}: {
  params: { token: string };
}) {
  const resolved = await resolveSurveyToken(params.token);

  if (!resolved.ok) {
    return (
      <CenterCard>
        <Link2Off className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Link indisponível</h1>
        <p className="mt-2 text-sm text-muted-foreground">{resolved.error}</p>
      </CenterCard>
    );
  }

  const { invite } = resolved;
  const [template, brand] = await Promise.all([
    prisma.surveyTemplate.findUnique({
      where: { id: invite.templateId },
      select: { name: true, status: true, questionsJson: true, settingsJson: true },
    }),
    getOrgBrand(invite.orgId).catch(() => null),
  ]);

  const settings = (template?.settingsJson ?? {}) as { thankYouMessage?: string };
  const thankYou =
    settings.thankYouMessage ??
    "Obrigado por responder! Sua opinião nos ajuda a melhorar.";

  // Gate pós-resposta: link não reabre a pesquisa (nem opt-out).
  if (invite.status === "responded" || invite.status === "optout") {
    return (
      <CenterCard>
        <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-green-600" />
        <h1 className="text-lg font-semibold">
          {invite.status === "responded" ? "Resposta registrada" : "Recebimento cancelado"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {invite.status === "responded"
            ? thankYou
            : "Você não receberá mais pesquisas neste e-mail."}
        </p>
      </CenterCard>
    );
  }

  if (!template) {
    return (
      <CenterCard>
        <Link2Off className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Pesquisa indisponível</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Esta pesquisa não está mais ativa.
        </p>
      </CenterCard>
    );
  }

  const questions = parseTemplateQuestions(template.questionsJson);
  if (questions.length === 0) {
    return (
      <CenterCard>
        <Link2Off className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Pesquisa indisponível</h1>
      </CenterCard>
    );
  }

  return (
    <SurveyPublicClient
      token={params.token}
      surveyName={template.name}
      brandName={brand?.displayName ?? null}
      brandLogoUrl={brand?.logoUrl ?? null}
      recipientName={invite.recipientName}
      questions={questions}
      thankYouMessage={thankYou}
    />
  );
}
