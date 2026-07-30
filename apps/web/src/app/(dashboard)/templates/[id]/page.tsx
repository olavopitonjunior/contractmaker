import { notFound } from "next/navigation";
import { createHash } from "crypto";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { TemplateEditor } from "@/components/templates/TemplateEditor";

function sha(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

export default async function EditTemplatePage({
  params,
}: {
  params: { id: string };
}) {
  const session = await auth();
  if (!session?.user) return null;

  const template = await prisma.contractTemplate.findUnique({
    where: { id: params.id },
  });

  if (!template) notFound();

  const fixtureModalidade =
    template.modalidade === "financiamento" ? "financiamento" : "a_vista";
  const expectedKey = sha(template.handlebarsSource + ":" + fixtureModalidade);
  const previewStale =
    template.engine !== "google_docs" &&
    !!template.googleTemplateDocId &&
    template.previewSourceHash !== expectedKey;

  return (
    <TemplateEditor
      mode="edit"
      template={{
        id: template.id,
        name: template.name,
        description: template.description || "",
        handlebarsSource: template.handlebarsSource,
        modalidade: template.modalidade,
        category: template.category,
        matchCriteria: template.matchCriteria,
        isDefault: template.isDefault,
        version: template.version,
        status: template.status,
        engine: template.engine,
        googleTemplateDocId: template.googleTemplateDocId,
        previewStale,
      }}
    />
  );
}
