import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { resolveFormRequiredFields } from "@/lib/forms/required-snapshot";
import { canAccessForm, viewerIsOrgMember } from "@/lib/forms/form-gate";
import { listGarantiaOptions } from "@/lib/forms/garantia-option-repo";
import { isLocacaoSchemaType } from "@/lib/forms/validation-locacao";
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

  // Campos obrigatórios por step, resolvidos server-side pelo MÓDULO do form:
  // venda lê o preset da org ao vivo; locação lê o snapshot gravado no próprio
  // formulário (retrocompat — ver lib/forms/required-snapshot.ts).
  const requiredFieldsByStep = await resolveFormRequiredFields(form);

  // Catálogo de garantias da imobiliária — desce daqui porque o formulário é
  // ANÔNIMO (não pode chamar uma API autenticada). Mesmo caminho do
  // requiredFieldsByStep. Só locação usa.
  const garantiaOptions = isLocacaoSchemaType(form.schemaType)
    ? await listGarantiaOptions(form.orgId, { activeOnly: true })
    : undefined;

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

  // Duas coisas ficam só pra quem é da imobiliária, porque o link é entregue ao
  // CLIENTE: os campos de recebimento da comissão (não é lugar de pedir dado
  // bancário de terceiro pra ele) e remover documento (antes qualquer portador
  // apagava documento de qualquer parte, sem deixar rastro). Nos dois casos o
  // servidor faz a MESMA checagem — esconder sem barrar seria só cosmético.
  const viewerIsMember = await viewerIsOrgMember(form.orgId);

  return (
    <FormPageClient
      token={form.token}
      schemaType={form.schemaType}
      initialData={(form.dataJson as Record<string, unknown>) || {}}
      requiredFieldsByStep={requiredFieldsByStep}
      garantiaOptions={garantiaOptions}
      prefilled={isPrefilled}
      proposalAttachmentUrl={proposalAttachmentUrl}
      locked={Boolean(form.lockedAt)}
      viewerIsMember={viewerIsMember}
    />
  );
}
