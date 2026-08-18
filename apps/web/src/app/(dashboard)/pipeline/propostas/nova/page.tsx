import { prisma } from "@/lib/db/prisma";
import { requireAnyFeaturePage } from "@/lib/modules/page-guard";
import { FEATURE } from "@/lib/modules/catalog";
import { getEffectivePermissions, can } from "@/lib/security/rbac/check";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { ProposalForm } from "@/components/proposals/ProposalForm";
import { ProposalsNoAccess } from "@/components/proposals/ProposalsNoAccess";
import { emptyProposalForm, PROPOSAL_SCHEMA_OPTIONS } from "@/lib/proposals/form-data";

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
  searchParams: { tipo?: string };
}) {
  const { userId, orgId, enabled } = await requireAnyFeaturePage([
    FEATURE.VENDAS_PROPOSTAS,
    FEATURE.LOCACAO_PROPOSTAS,
  ]);

  const vendasOn = enabled[FEATURE.VENDAS_PROPOSTAS];
  const locacaoOn = enabled[FEATURE.LOCACAO_PROPOSTAS];
  const requested = searchParams.tipo === "locacao" ? "locacao" : "venda";
  // Tipo pedido mas desabilitado no tenant cai no que está ligado (o guard acima
  // já garantiu que ao menos um está).
  const tipo: "venda" | "locacao" =
    requested === "locacao" ? (locacaoOn ? "locacao" : "venda") : vendasOn ? "venda" : "locacao";

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

  return (
    <ProposalForm
      mode="create"
      initial={emptyProposalForm(tipo, schemaOptions[0].value)}
      schemaOptions={schemaOptions}
      members={members}
      canAssign={canAssign}
    />
  );
}
