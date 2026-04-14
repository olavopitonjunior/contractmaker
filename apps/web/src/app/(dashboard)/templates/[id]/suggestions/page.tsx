import { notFound, redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { TemplateSuggestionsClient } from "@/components/templates/TemplateSuggestionsClient";

export default async function TemplateSuggestionsPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/templates");

  const template = await prisma.contractTemplate.findFirst({
    where: { id: params.id, orgId: org.id },
    select: {
      id: true,
      name: true,
      version: true,
      modalidade: true,
      handlebarsSource: true,
    },
  });

  if (!template) notFound();

  const suggestions = await prisma.templateSuggestion.findMany({
    where: { templateId: template.id, orgId: org.id },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 50,
  });

  return (
    <TemplateSuggestionsClient
      template={template}
      initialSuggestions={suggestions.map((s) => ({
        ...s,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
        resolvedAt: s.resolvedAt?.toISOString() || null,
      }))}
    />
  );
}
