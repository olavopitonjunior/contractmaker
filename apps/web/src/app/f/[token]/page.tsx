import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { resolveFormRequiredFields } from "@/lib/forms/required-snapshot";
import { canAccessForm } from "@/lib/forms/form-gate";
import { FormClosedNotice } from "@/components/forms/FormClosedNotice";
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
      schemaType={form.schemaType}
      initialData={(form.dataJson as Record<string, unknown>) || {}}
      requiredFieldsByStep={requiredFieldsByStep}
      prefilled={isPrefilled}
      proposalAttachmentUrl={proposalAttachmentUrl}
      locked={Boolean(form.lockedAt)}
    />
  );
}
