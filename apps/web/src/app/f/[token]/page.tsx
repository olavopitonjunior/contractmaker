import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { resolveAllRequiredFields } from "@/lib/forms/presets";
import { FormPageClient } from "./form-client";

export default async function PublicFormPage({
  params,
  searchParams,
}: {
  params: { token: string };
  searchParams: { prefilled?: string };
}) {
  const form = await prisma.salesForm.findUnique({
    where: { token: params.token },
  });

  if (!form) {
    notFound();
  }

  // Resolve OrgFormSettings server-side e calcula required fields por step.
  // Lazy: forms criados antes da migração 20260515120000 não têm row ainda;
  // null cai no preset "legado" via `resolveAllRequiredFields`.
  const orgFormSettings = await prisma.orgFormSettings.findUnique({
    where: { orgId: form.orgId },
  });
  const requiredFieldsByStep = resolveAllRequiredFields(orgFormSettings).map(
    (paths) => Array.from(paths),
  );

  // Banner "dados extraídos da proposta" — só quando vier `?prefilled=1` na URL
  // (link de redirect de `/deals/new-from-proposal`) E houver attachment de
  // proposta. Sem o attachment, sem botão "ver original".
  const isPrefilled = searchParams?.prefilled === "1";
  let proposalAttachmentUrl: string | null = null;
  if (isPrefilled) {
    const proposalAttachment = await prisma.formAttachment.findFirst({
      where: { formId: form.id, category: "proposta_original" },
      orderBy: { createdAt: "desc" },
      select: { url: true },
    });
    proposalAttachmentUrl = proposalAttachment?.url ?? null;
  }

  return (
    <FormPageClient
      token={form.token}
      initialData={(form.dataJson as Record<string, unknown>) || {}}
      requiredFieldsByStep={requiredFieldsByStep}
      prefilled={isPrefilled}
      proposalAttachmentUrl={proposalAttachmentUrl}
    />
  );
}
