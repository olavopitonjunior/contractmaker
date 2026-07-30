import { notFound } from "next/navigation";
import { createHash } from "crypto";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { resolveUserOrgId } from "@/lib/security/org-scope";
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

  // Guard cross-org na query (mesmo padrão de contracts/[id]): sem ele o
  // `handlebarsSource` — o texto contratual proprietário de outra imobiliária —
  // ficava legível só com o id. `ContractTemplate.orgId` é direto (não passa
  // pelo pipeline), então o filtro é o próprio orgId. A LISTA já era escopada;
  // só o detalhe ficou de fora.
  const orgId = await resolveUserOrgId(session.user.id);
  if (!orgId) notFound();

  const template = await prisma.contractTemplate.findFirst({
    where: { id: params.id, orgId },
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
