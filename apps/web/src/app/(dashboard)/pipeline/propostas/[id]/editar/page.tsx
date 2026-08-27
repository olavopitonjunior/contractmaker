import { prisma } from "@/lib/db/prisma";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { redirect, notFound } from "next/navigation";
import { getEffectivePermissions, canAccessProposal, can } from "@/lib/security/rbac/check";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { getEffectiveUserId } from "@/lib/auth/impersonation";
import { EDITABLE_STATUSES } from "@/lib/proposals/status-sets";
import { ProposalForm } from "@/components/proposals/ProposalForm";
import { parseProposalFormFromRow, PROPOSAL_SCHEMA_OPTIONS } from "@/lib/proposals/form-data";
import { getIListConnection } from "@/lib/ilist/connection";
import { listGarantiaOptions } from "@/lib/forms/garantia-option-repo";

export const dynamic = "force-dynamic";

/**
 * Edição pré-envio (`/pipeline/propostas/[id]/editar`) — mesma UI da criação,
 * pré-carregada do `dataJson` + linhas de `ProposalSigner`.
 *
 * Fora de `EDITABLE_STATUSES` a rota REDIRECIONA pro detalhe em vez de renderizar
 * um formulário que o PATCH recusaria com 409 (o guard de verdade está lá).
 *
 * O mesmo vale pra PERMISSÃO: `canAccessProposal` é só escopo e libera quem tem
 * `PROPOSAL_VIEW_ALL` (o papel `viewer`, somente-leitura). Sem a checagem de
 * escrita abaixo esta página servia o formulário inteiro, preenchido, pra quem o
 * PATCH agora recusa com 403 — o usuário só descobriria ao salvar. Os dois
 * gates têm de ser o MESMO; se um mudar, muda o outro junto.
 */
export default async function EditarPropostaPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/pipeline");
  const effUserId = await getEffectiveUserId(session.user.id);

  const proposal = await prisma.proposal.findUnique({ where: { id: params.id } });
  if (!proposal || proposal.orgId !== org.id) notFound();

  const eff = await getEffectivePermissions(effUserId, org.id);
  if (
    !eff ||
    !canAccessProposal({
      effective: eff,
      ownerUserId: proposal.userId,
      responsibleUserId: proposal.responsibleUserId,
    })
  ) {
    notFound();
  }

  // Espelha o guard do PATCH /api/proposals/[id].
  if (!can(eff, PERMISSION.PROPOSAL_CREATE) && !can(eff, PERMISSION.PROPOSAL_SEND)) {
    redirect(`/pipeline/propostas/${params.id}`);
  }

  if (!EDITABLE_STATUSES.has(proposal.status)) {
    redirect(`/pipeline/propostas/${params.id}`);
  }

  const signers = await prisma.proposalSigner.findMany({
    where: { proposalId: params.id },
    orderBy: { signingGroup: "asc" },
  });

  // Mesmo gate do dropdown do pipeline: sem conexão provisionada, o botão do
  // catálogo iList (RE/MAX) não aparece.
  const hasIList = (await getIListConnection(org.id)) !== null;

  const tipo = proposal.kind === "locacao" ? "locacao" : "venda";
  const initial = parseProposalFormFromRow(proposal, signers, {
    validUntil: proposal.validUntil?.toISOString() ?? null,
  });

  const garantiaOptions =
    tipo === "locacao"
      ? await listGarantiaOptions(proposal.orgId, { activeOnly: true })
      : [];

  return (
    <ProposalForm
      mode="edit"
      proposalId={params.id}
      initial={initial}
      schemaOptions={PROPOSAL_SCHEMA_OPTIONS[tipo]}
      hasIList={hasIList}
      garantiaOptions={garantiaOptions}
    />
  );
}
