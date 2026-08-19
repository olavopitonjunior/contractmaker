import { prisma } from "@/lib/db/prisma";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { redirect, notFound } from "next/navigation";
import { getEffectivePermissions, canAccessProposal } from "@/lib/security/rbac/check";
import { getEffectiveUserId } from "@/lib/auth/impersonation";
import { EDITABLE_STATUSES } from "@/lib/proposals/status-sets";
import { ProposalForm } from "@/components/proposals/ProposalForm";
import { parseProposalForm, PROPOSAL_SCHEMA_OPTIONS } from "@/lib/proposals/form-data";
import { getIListConnection } from "@/lib/ilist/connection";

export const dynamic = "force-dynamic";

/**
 * Edição pré-envio (`/pipeline/propostas/[id]/editar`) — mesma UI da criação,
 * pré-carregada do `dataJson` + linhas de `ProposalSigner`.
 *
 * Fora de `EDITABLE_STATUSES` a rota REDIRECIONA pro detalhe em vez de renderizar
 * um formulário que o PATCH recusaria com 409 (o guard de verdade está lá).
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
  const initial = parseProposalForm({
    kind: proposal.kind,
    schemaType: proposal.schemaType,
    title: proposal.title,
    dataJson: proposal.dataJson,
    validUntil: proposal.validUntil?.toISOString() ?? null,
    comissaoIncluida: proposal.comissaoIncluida,
    hiddenPaths: proposal.hiddenPaths,
    signers: signers.map((s) => ({
      role: s.role ?? "",
      name: s.name,
      email: s.email,
      cpf: s.cpf,
      phone: s.phone,
      notifyChannel: s.notifyChannel,
    })),
  });

  return (
    <ProposalForm
      mode="edit"
      proposalId={params.id}
      initial={initial}
      schemaOptions={PROPOSAL_SCHEMA_OPTIONS[tipo]}
      hasIList={hasIList}
    />
  );
}
