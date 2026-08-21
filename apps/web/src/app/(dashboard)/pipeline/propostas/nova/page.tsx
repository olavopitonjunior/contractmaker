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
  parseProposalFormFromRow,
  PROPOSAL_SCHEMA_OPTIONS,
  type ProposalFormValues,
} from "@/lib/proposals/form-data";
import { getIListConnection } from "@/lib/ilist/connection";
import { resolveRecreationAssignee } from "@/lib/proposals/recreate-assignee";

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
  // `searchParams` cru pode trazer array (`?fromId=a&fromId=b`) apesar do tipo
  // declarado — array no `where.id` estoura o Prisma em 500.
  const fromId =
    typeof searchParams.fromId === "string" ? searchParams.fromId : undefined;
  let fromProposal: Awaited<ReturnType<typeof prisma.proposal.findUnique>> = null;
  if (fromId) {
    const row = await prisma.proposal.findUnique({ where: { id: fromId } });
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

  // Escopo (dono/responsável/VIEW_ALL) — mesmo corte do /editar. Fora dele o
  // fromId é ignorado silenciosamente (form vazio). Resolvido ANTES das buscas
  // abaixo: é decisão pura, e decidi-la primeiro evita buscar os signatários de
  // uma proposta que o escopo vai descartar.
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

  // Admin/gestor cria já atribuindo (select "Responsável" no form). Sem
  // PROPOSAL_ASSIGN o select nem aparece e a lista não é carregada.
  const canAssign = can(eff, PERMISSION.PROPOSAL_ASSIGN);

  // As três buscas não dependem uma da outra — serializá-las somava três idas
  // ao banco na abertura da página, cada uma esperando a anterior sem motivo.
  // iList (RE/MAX): botão de busca no catálogo só quando o tenant tem conexão
  // provisionada pelo super-admin — mesmo gate do dropdown do pipeline.
  const [ilistConnection, memberRows, signers] = await Promise.all([
    getIListConnection(orgId),
    canAssign
      ? prisma.orgMembership.findMany({
          where: { orgId },
          select: { user: { select: { id: true, name: true } } },
          orderBy: { user: { name: "asc" } },
        })
      : Promise.resolve([]),
    fromProposal
      ? prisma.proposalSigner.findMany({
          where: { proposalId: fromProposal.id },
          orderBy: { signingGroup: "asc" },
        })
      : Promise.resolve([]),
  ]);

  const hasIList = ilistConnection !== null;
  const members = memberRows
    .map((m) => ({ id: m.user.id, name: m.user.name ?? "Sem nome" }))
    .filter((m) => m.id);

  let initial: ProposalFormValues = emptyProposalForm(tipo, schemaOptions[0].value);
  let parentProposalId: string | undefined;
  let initialResponsibleUserId: string | undefined;
  let initialResponsibleName: string | undefined;
  if (fromProposal) {
    // Validade: preserva a JANELA original (createdAt→validUntil do pai),
    // recontada a partir de agora. O instante cru não serve: no fluxo normal o
    // pai já chega TERMINAL aqui (o diálogo cancelou antes de navegar), e uma
    // validade custom de 30 dias resetaria em silêncio pro default de 7 —
    // contradizendo o "mesmos dados" do diálogo. Janela inválida/ausente →
    // null (form volta ao default).
    const janelaMs = fromProposal.validUntil
      ? fromProposal.validUntil.getTime() - fromProposal.createdAt.getTime()
      : null;
    const janelaDias =
      janelaMs && janelaMs > 0 ? Math.round(janelaMs / 86_400_000) : null;
    initial = parseProposalFormFromRow(fromProposal, signers, {
      validUntil: janelaDias
        ? new Date(Date.now() + janelaDias * 86_400_000).toISOString()
        : null,
    });
    parentProposalId = fromProposal.id;
    // Regra em `lib/proposals/recreate-assignee`: sem permissão de atribuir,
    // ex-membro e responsável externo são três casos de borda distintos, e
    // aqui dentro não davam pra exercitar sem levantar Prisma e sessão.
    const assignee = resolveRecreationAssignee({
      canAssign,
      responsibleUserId: fromProposal.responsibleUserId,
      responsibleName: fromProposal.responsibleName,
      memberIds: members.map((m) => m.id),
    });
    initialResponsibleUserId = assignee.responsibleUserId;
    initialResponsibleName = assignee.responsibleName;
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
      initialResponsibleName={initialResponsibleName}
    />
  );
}
