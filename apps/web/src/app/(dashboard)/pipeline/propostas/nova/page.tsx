import { prisma } from "@/lib/db/prisma";
import { requireAnyFeaturePage } from "@/lib/modules/page-guard";
import { FEATURE } from "@/lib/modules/catalog";
import {
  getEffectivePermissions,
  canAccessProposal,
  can,
} from "@/lib/security/rbac/check";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { ProposalForm } from "@/components/proposals/ProposalForm";
import { ProposalsNoAccess } from "@/components/proposals/ProposalsNoAccess";
import {
  emptyProposalForm,
  parseProposalForm,
  PROPOSAL_SCHEMA_OPTIONS,
  type ProposalFormValues,
} from "@/lib/proposals/form-data";
import { TERMINAL_STATUSES } from "@/lib/proposals/status-sets";
import { getIListConnection } from "@/lib/ilist/connection";

export const dynamic = "force-dynamic";

/**
 * Criação de proposta em PÁGINA dedicada (`/pipeline/propostas/nova?tipo=…`).
 *
 * Substitui o `NovaPropostaDialog`: como é URL, abre em nova guia, sobrevive a
 * um clique fora e volta pelo histórico. O gate de feature aqui é o mesmo do
 * POST /api/proposals — a página não é a segurança, mas evita oferecer uma tela
 * cujo submit o servidor recusaria.
 */
export default async function NovaPropostaPage({
  searchParams,
}: {
  searchParams: { tipo?: string; fromId?: string };
}) {
  const { userId, orgId, enabled } = await requireAnyFeaturePage([
    FEATURE.VENDAS_PROPOSTAS,
    FEATURE.LOCACAO_PROPOSTAS,
  ]);

  const vendasOn = enabled[FEATURE.VENDAS_PROPOSTAS];
  const locacaoOn = enabled[FEATURE.LOCACAO_PROPOSTAS];

  // Recriação (`?fromId=`): carrega a proposta de origem ANTES de resolver o
  // tipo — o kind dela sobrepõe `?tipo=`. Guard de org + escopo espelha o do
  // /editar; sem match, ignora o fromId e abre o form vazio (não é notFound de
  // propósito: a página continua útil pra criar do zero).
  let fromProposal: Awaited<ReturnType<typeof prisma.proposal.findUnique>> = null;
  if (searchParams.fromId) {
    const row = await prisma.proposal.findUnique({ where: { id: searchParams.fromId } });
    if (row && row.orgId === orgId) fromProposal = row;
  }

  const requested =
    (fromProposal ? fromProposal.kind : searchParams.tipo) === "locacao"
      ? "locacao"
      : "venda";
  // Tipo pedido mas desabilitado no tenant cai no que está ligado (o guard acima
  // já garantiu que ao menos um está).
  const tipo: "venda" | "locacao" =
    requested === "locacao" ? (locacaoOn ? "locacao" : "venda") : vendasOn ? "venda" : "locacao";
  // Kind da origem indisponível no tenant → prefill não faz sentido.
  if (fromProposal && fromProposal.kind !== tipo) fromProposal = null;

  const eff = await getEffectivePermissions(userId, orgId);
  if (!eff || !can(eff, PERMISSION.PROPOSAL_CREATE)) {
    return (
      <ProposalsNoAccess
        title="Você não tem permissão para criar propostas"
        description="Seu papel atual não inclui a criação de propostas. Peça a um administrador da organização para ajustar seu papel em Configurações → Equipe."
      />
    );
  }

  const schemaOptions = PROPOSAL_SCHEMA_OPTIONS[tipo];

  // iList (RE/MAX): botão de busca no catálogo só quando o tenant tem conexão
  // provisionada pelo super-admin — mesmo gate do dropdown do pipeline.
  const hasIList = (await getIListConnection(orgId)) !== null;

  // Admin/gestor cria já atribuindo (select "Responsável" no form). Sem
  // PROPOSAL_ASSIGN o select nem aparece e a lista não é carregada.
  const canAssign = can(eff, PERMISSION.PROPOSAL_ASSIGN);
  const members = canAssign
    ? (
        await prisma.orgMembership.findMany({
          where: { orgId },
          select: { user: { select: { id: true, name: true } } },
          orderBy: { user: { name: "asc" } },
        })
      )
        .map((m) => ({ id: m.user.id, name: m.user.name ?? "Sem nome" }))
        .filter((m) => m.id)
    : [];

  // Escopo (dono/responsável/VIEW_ALL) — mesmo corte do /editar. Fora dele o
  // fromId é ignorado silenciosamente (form vazio).
  if (
    fromProposal &&
    !canAccessProposal({
      effective: eff,
      ownerUserId: fromProposal.userId,
      responsibleUserId: fromProposal.responsibleUserId,
    })
  ) {
    fromProposal = null;
  }

  let initial: ProposalFormValues = emptyProposalForm(tipo, schemaOptions[0].value);
  let parentProposalId: string | undefined;
  let initialResponsibleUserId: string | undefined;
  if (fromProposal) {
    const signers = await prisma.proposalSigner.findMany({
      where: { proposalId: fromProposal.id },
      orderBy: { signingGroup: "asc" },
    });
    // Validade: null quando já venceu ou a proposta é terminal —
    // `parseProposalForm` reconstituiria "0 dias" e a recriação nasceria
    // expirável no ato; null faz o form voltar ao default de 7 dias.
    const validadeViva =
      fromProposal.validUntil &&
      fromProposal.validUntil.getTime() > Date.now() &&
      !TERMINAL_STATUSES.has(fromProposal.status);
    initial = parseProposalForm({
      kind: fromProposal.kind,
      schemaType: fromProposal.schemaType,
      title: fromProposal.title,
      dataJson: fromProposal.dataJson,
      validUntil: validadeViva ? fromProposal.validUntil!.toISOString() : null,
      comissaoIncluida: fromProposal.comissaoIncluida,
      hiddenPaths: fromProposal.hiddenPaths,
      signers: signers.map((s) => ({
        role: s.role ?? "",
        name: s.name,
        email: s.email,
        cpf: s.cpf,
        phone: s.phone,
        notifyChannel: s.notifyChannel,
      })),
    });
    parentProposalId = fromProposal.id;
    // Sem PROPOSAL_ASSIGN o POST recusaria o campo — o responsável cai pro
    // criador, que é o comportamento padrão da criação.
    if (canAssign && fromProposal.responsibleUserId) {
      initialResponsibleUserId = fromProposal.responsibleUserId;
    }
  }

  return (
    <ProposalForm
      mode="create"
      initial={initial}
      schemaOptions={schemaOptions}
      members={members}
      canAssign={canAssign}
      hasIList={hasIList}
      parentProposalId={parentProposalId}
      initialResponsibleUserId={initialResponsibleUserId}
    />
  );
}
