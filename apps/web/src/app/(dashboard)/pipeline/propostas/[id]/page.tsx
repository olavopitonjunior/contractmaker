import { prisma } from "@/lib/db/prisma";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { redirect, notFound } from "next/navigation";
import {
  getEffectivePermissions,
  canAccessProposal,
  can,
} from "@/lib/security/rbac/check";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { responsibleDisplay } from "@/lib/proposals/status-view";
import { clicksignRoleLabel } from "@/lib/clicksign/roles";
import { ProposalDetailClient } from "@/components/proposals/ProposalDetailClient";
import { getEffectiveUserId } from "@/lib/auth/impersonation";
import { formatDateTimeBR, deadlineBR } from "@/lib/format/datetime";
import { formatMoneyBR } from "@/lib/format/money";

export const dynamic = "force-dynamic";

// Rótulo PT do papel de domínio do ProposalSigner (fallback Aceite, sem envelope).
const PLAN_ROLE_LABEL: Record<string, string> = {
  proponente: "Proponente",
  vendedor: "Vendedor",
  testemunha: "Testemunha",
  corretora: "Corretora",
};

export default async function PropostaDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/pipeline");

  // Impersonation: sob "trocar de tenant", quem resolve membership/RBAC é o dono
  // do tenant, não o super_admin (ver lib/auth/impersonation.ts).
  const effUserId = await getEffectiveUserId(session.user.id);

  const proposal = await prisma.proposal.findUnique({
    where: { id: params.id },
    include: {
      user: { select: { id: true, name: true } },
      responsibleUser: { select: { id: true, name: true, image: true } },
    },
  });
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

  const [planSigners, events, attachments, memberRows, envelopes] = await Promise.all([
    prisma.proposalSigner.findMany({
      where: { proposalId: params.id },
      orderBy: { signingGroup: "asc" },
    }),
    prisma.proposalEvent.findMany({
      where: { proposalId: params.id },
      orderBy: { receivedAt: "desc" },
      take: 50,
    }),
    prisma.proposalAttachment.findMany({ where: { proposalId: params.id } }),
    prisma.orgMembership.findMany({
      where: { orgId: org.id },
      select: { user: { select: { id: true, name: true } } },
      orderBy: { user: { name: "asc" } },
    }),
    prisma.envelope.findMany({
      where: { proposalId: params.id, source: "proposal", status: { notIn: ["failed"] } },
      select: {
        via: true,
        signers: {
          select: { id: true, name: true, role: true, notifyChannel: true, status: true },
          orderBy: { signingGroup: "asc" },
        },
      },
      orderBy: { via: "asc" },
    }),
  ]);

  // Status REAL por signatário vem do EnvelopeSigner (onde vive sign/view/refuse),
  // não do ProposalSigner (plano). Sem isso o status por-linha sumia em propostas
  // terminais (polling off) — ex.: numa recusada não dava pra ver quem recusou.
  // Papel exibível: traduz a qualificação ClickSign (inglês) → PT via
  // clicksignRoleLabel (inclui testemunha; sourceKind colapsaria pra comprador).
  const envelopeSigners = envelopes.flatMap((e) =>
    e.signers.map((s) => ({
      id: s.id,
      name: s.name,
      role: clicksignRoleLabel(s.role) ?? "",
      channel: s.notifyChannel,
      status: s.status,
    }))
  );
  // Fallback pro ProposalSigner quando NÃO há envelope: propostas via Aceite
  // (WhatsApp) não criam Envelope, então o status por-signatário vive em
  // ProposalSigner.acceptanceStatus — sem isto o Aceite perdia a visibilidade de
  // quem aceitou/recusou. Também cobre rascunho (acceptanceStatus vazio → sem badge).
  const signers =
    envelopeSigners.length > 0
      ? envelopeSigners.filter((s) => s.status !== "removed")
      : planSigners.map((s) => ({
          id: s.id,
          name: s.name,
          // Papel de domínio (proponente/vendedor/testemunha) rotulado em PT
          // capitalizado — mesmo formato do ramo de envelope (que traduz via
          // clicksignRoleLabel), pra não misturar "· proponente" com "· Vendedor".
          role: PLAN_ROLE_LABEL[s.role ?? ""] ?? s.role ?? "",
          channel: s.notifyChannel,
          status: s.acceptanceStatus ?? "",
        }));

  const d = (proposal.dataJson ?? {}) as Record<string, unknown>;
  const resp = responsibleDisplay({
    responsibleName: proposal.responsibleName,
    responsibleUser: proposal.responsibleUser,
    user: proposal.user,
  });

  // Data/hora e prazo saem FORMATADOS daqui. O client component não pode chamar
  // `toLocale*` nem `Date.now()` no render: o padrão de locale do ICU do Node
  // difere do ICU do browser e o "faltam Xd" muda entre o SSR e a hidratação —
  // os dois viram texto diferente no mesmo nó e derrubam a hidratação (React
  // #418/#423, que faz a página re-renderizar do zero e o card "Documento"
  // aparecer vazio). Ver lib/format/datetime.ts.
  const prazo = deadlineBR(proposal.validUntil);

  const permissions = {
    send: can(eff, PERMISSION.PROPOSAL_SEND),
    convert: can(eff, PERMISSION.PROPOSAL_CONVERT),
    cancel: can(eff, PERMISSION.PROPOSAL_CANCEL),
    delete: can(eff, PERMISSION.PROPOSAL_DELETE),
    resend: can(eff, PERMISSION.PROPOSAL_RESEND),
    assign: can(eff, PERMISSION.PROPOSAL_ASSIGN),
  };

  return (
    <ProposalDetailClient
      proposal={{
        id: proposal.id,
        title: proposal.title,
        status: proposal.status,
        kind: proposal.kind,
        instrument: proposal.instrument,
        createdAtLabel: formatDateTimeBR(proposal.createdAt),
        sentAtLabel: formatDateTimeBR(proposal.sentAt),
        deliveredAtLabel: formatDateTimeBR(proposal.deliveredAt),
        firstViewedAtLabel: formatDateTimeBR(proposal.firstViewedAt),
        viewCount: proposal.viewCount,
        lastReminderAtLabel: formatDateTimeBR(proposal.lastReminderAt),
        reminderCount: proposal.reminderCount,
        validUntilLabel: formatDateTimeBR(proposal.validUntil),
        prazo: { label: prazo.label, danger: prazo.tone === "danger" },
        convertedDealId: proposal.convertedDealId,
        dossierUrl: proposal.dossierUrl,
        resumo: summarize(d, proposal.kind),
        responsible: resp,
        responsibleUserId: proposal.responsibleUserId,
        responsibleName: proposal.responsibleName,
      }}
      // Documento congelado no envio. Vai inteiro pro client porque é ele que a
      // janela "Documento" exibe quando a proposta já saiu — re-renderizar o
      // template atual mostraria um texto que ninguém assinou.
      sentSnapshotHtml={proposal.sentSnapshotHtml}
      signers={signers.map((s) => ({
        id: s.id,
        name: s.name,
        role: s.role,
        channel: s.channel,
        status: s.status,
      }))}
      events={events.map((e) => ({
        id: e.id,
        eventName: e.eventName,
        receivedAtLabel: formatDateTimeBR(e.receivedAt),
      }))}
      attachments={attachments.map((a) => ({
        id: a.id,
        filename: a.filename,
        category: a.category,
        url: a.url,
      }))}
      members={memberRows.map((m) => ({ id: m.user.id, name: m.user.name ?? "Sem nome" }))}
      permissions={permissions}
    />
  );
}

function summarize(d: Record<string, unknown>, kind: string) {
  const isVenda = kind === "venda";
  const parte = (isVenda ? d.compradores : d.locatarios) as Array<{ nome?: string }> | undefined;
  const imoveis = d.imoveis as Array<{ endereco?: string }> | undefined;
  const pag = d.pagamento as { valor_total?: number } | undefined;
  const loc = d.locacao as { valor_aluguel?: number } | undefined;
  const valor = pag?.valor_total ?? loc?.valor_aluguel ?? null;
  return {
    proponente: parte?.[0]?.nome ?? null,
    imovel: imoveis?.[0]?.endereco ?? null,
    // Formatado aqui (determinístico, sem ICU) pelo mesmo motivo das datas.
    valorLabel: valor == null ? null : formatMoneyBR(valor, { decimals: 0 }),
  };
}
