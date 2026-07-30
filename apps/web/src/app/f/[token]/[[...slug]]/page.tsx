import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { resolveAllRequiredFields } from "@/lib/forms/presets";
import { canAccessForm, viewerIsOrgMember } from "@/lib/forms/form-gate";
import { FormClosedNotice } from "@/components/forms/FormClosedNotice";
import { FormPageClient } from "../form-client";

export default async function PublicFormPage({
  params,
  searchParams,
}: {
  // `slug` é decorativo (título do negócio na URL) — a resolução é só por token.
  params: { token: string; slug?: string[] };
  searchParams: { prefilled?: string };
}) {
  const form = await prisma.salesForm.findUnique({
    where: { token: params.token },
  });

  if (!form) {
    notFound();
  }

  // Form enviado: só membro da org segue vendo os dados. Para o público o link
  // vira um aviso sem conteúdo — a página nem chega a montar o wizard, então
  // nenhum dataJson viaja pro browser.
  if (!(await canAccessForm(form))) {
    return <FormClosedNotice />;
  }

  // Resolve OrgFormSettings server-side e calcula required fields por step
  // (preset de venda). Locação tem validação própria no wizard/servidor, então
  // pula esse cálculo (os steps não batem com o preset de venda).
  const isLocacao = form.schemaType?.startsWith("locacao");
  const orgFormSettings = isLocacao
    ? null
    : await prisma.orgFormSettings.findUnique({ where: { orgId: form.orgId } });
  const requiredFieldsByStep = isLocacao
    ? []
    : resolveAllRequiredFields(orgFormSettings).map((paths) => Array.from(paths));

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

  // Remover documento passa a ser só de quem é da imobiliária: o link fica com
  // o cliente, e antes qualquer portador apagava documento de qualquer parte
  // sem deixar rastro. O DELETE da rota faz a mesma checagem — isto é a metade
  // visual.
  const viewerIsMember = await viewerIsOrgMember(form.orgId);

  return (
    <FormPageClient
      token={form.token}
      schemaType={form.schemaType}
      initialData={(form.dataJson as Record<string, unknown>) || {}}
      requiredFieldsByStep={requiredFieldsByStep}
      prefilled={isPrefilled}
      proposalAttachmentUrl={proposalAttachmentUrl}
      locked={Boolean(form.lockedAt)}
      viewerIsMember={viewerIsMember}
    />
  );
}
