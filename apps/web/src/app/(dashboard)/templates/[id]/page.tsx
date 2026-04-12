import { notFound } from "next/navigation";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { TemplateEditor } from "@/components/templates/TemplateEditor";

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

  return (
    <TemplateEditor
      mode="edit"
      template={{
        id: template.id,
        name: template.name,
        description: template.description || "",
        handlebarsSource: template.handlebarsSource,
        modalidade: template.modalidade,
        isDefault: template.isDefault,
        version: template.version,
        status: template.status,
      }}
    />
  );
}
