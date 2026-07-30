import { notFound } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { TemplateReviewClient } from "@/components/templates/TemplateReviewClient";

export default async function TemplateReviewPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await auth();
  if (!session?.user) return null;
  const org = await getUserOrg(session.user.id);
  if (!org) return null;

  const template = await prisma.contractTemplate.findUnique({
    where: { id: params.id },
  });
  if (!template || template.orgId !== org.id) notFound();
  if (template.engine !== "google_docs" || !template.googleTemplateDocId) {
    notFound();
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Revisão do modelo — ${template.name}`}
        description="Confira os placeholders no documento (edite direto no Doc se precisar), revalide e ative o template."
      />
      <TemplateReviewClient
        template={{
          id: template.id,
          name: template.name,
          modalidade: template.modalidade ?? "a_vista",
          matchCriteria: template.matchCriteria,
          status: template.status,
          isDefault: template.isDefault,
          // Relatório da ingestão — traz os avisos de slot de cláusula, que
          // travam a ativação até o operador decidir (ver TemplateReviewClient).
          draftReport: template.draftReport,
          docId: template.googleTemplateDocId,
          embedLink: `https://docs.google.com/document/d/${template.googleTemplateDocId}/edit?embedded=true&rm=embedded`,
        }}
      />
    </div>
  );
}
