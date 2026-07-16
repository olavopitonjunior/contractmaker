import { prisma } from "@/lib/db/prisma";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { redirect, notFound } from "next/navigation";
import {
  getEffectivePermissions,
  canAccessProposal,
} from "@/lib/security/rbac/check";
import { ProposalDetailClient } from "@/components/proposals/ProposalDetailClient";

export const dynamic = "force-dynamic";

export default async function PropostaDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/pipeline");

  const proposal = await prisma.proposal.findUnique({ where: { id: params.id } });
  if (!proposal || proposal.orgId !== org.id) notFound();

  const eff = await getEffectivePermissions(session.user.id, org.id);
  if (!eff || !canAccessProposal({ effective: eff, ownerUserId: proposal.userId })) {
    notFound();
  }

  const [signers, events, attachments] = await Promise.all([
    prisma.proposalSigner.findMany({
      where: { proposalId: params.id },
      orderBy: { signingGroup: "asc" },
    }),
    prisma.proposalEvent.findMany({
      where: { proposalId: params.id },
      orderBy: { receivedAt: "desc" },
      take: 30,
    }),
    prisma.proposalAttachment.findMany({ where: { proposalId: params.id } }),
  ]);

  const d = (proposal.dataJson ?? {}) as Record<string, unknown>;

  return (
    <ProposalDetailClient
      proposal={{
        id: proposal.id,
        title: proposal.title,
        status: proposal.status,
        kind: proposal.kind,
        validUntil: proposal.validUntil?.toISOString() ?? null,
        createdAt: proposal.createdAt.toISOString(),
        dossierUrl: proposal.dossierUrl,
        resumo: summarize(d, proposal.kind),
      }}
      signers={signers.map((s) => ({
        id: s.id,
        name: s.name,
        role: s.role,
        channel: s.notifyChannel,
        status: "—",
      }))}
      events={events.map((e) => ({
        id: e.id,
        eventName: e.eventName,
        receivedAt: e.receivedAt.toISOString(),
      }))}
      attachments={attachments.map((a) => ({
        id: a.id,
        filename: a.filename,
        category: a.category,
        url: a.url,
      }))}
    />
  );
}

function summarize(d: Record<string, unknown>, kind: string) {
  const isVenda = kind === "venda";
  const parte = (isVenda ? d.compradores : d.locatarios) as Array<{ nome?: string }> | undefined;
  const imoveis = d.imoveis as Array<{ endereco?: string }> | undefined;
  const pag = d.pagamento as { valor_total?: number } | undefined;
  const loc = d.locacao as { valor_aluguel?: number } | undefined;
  return {
    proponente: parte?.[0]?.nome ?? null,
    imovel: imoveis?.[0]?.endereco ?? null,
    valor: pag?.valor_total ?? loc?.valor_aluguel ?? null,
  };
}
