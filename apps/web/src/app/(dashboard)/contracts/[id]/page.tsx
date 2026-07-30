import { notFound } from "next/navigation";
import { auth } from "@/lib/auth/auth";
import { getEffectiveUserId } from "@/lib/auth/impersonation";
import { prisma } from "@/lib/db/prisma";
import { ContractEditorPage } from "@/components/contracts/ContractEditorPage";
import { getEffectivePermissions, canAccessDeal } from "@/lib/security/rbac/check";
import {
  contractOrgScopeWhere,
  resolveUserOrgId,
} from "@/lib/security/org-scope";
import { resolveSettingsFamily } from "@/lib/contracts/default-config";
import {
  loadOrgContractDefaults,
  loadOrgLocacaoDefaults,
} from "@/lib/contracts/org-defaults";

export default async function ContractPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await auth();
  if (!session?.user?.id) return null;

  // Guard cross-org NA QUERY (deny-by-default): sem ele qualquer usuário
  // autenticado abria o contrato de outro tenant só com o id. Escopo via
  // `deal.pipeline.orgId` — Deal não tem orgId direto. Mismatch e inexistente
  // caem no MESMO notFound(), pra não confirmar a existência do recurso.
  const orgId = await resolveUserOrgId(session.user.id);
  if (!orgId) notFound();

  const contract = await prisma.contract.findFirst({
    where: contractOrgScopeWhere(params.id, orgId),
    include: {
      // `pipeline.kind` discrimina a família da aba Configurações (venda ×
      // locação). `userId`/`managerUserId` alimentam o escopo do Gerente.
      deal: {
        select: {
          id: true,
          title: true,
          userId: true,
          managerUserId: true,
          pipeline: { select: { kind: true } },
        },
      },
      template: { select: { id: true, name: true } },
      chatSessions: {
        where: { archived: false },
        include: { messages: { orderBy: { createdAt: "asc" } } },
        orderBy: { updatedAt: "desc" },
        take: 1,
      },
      exports: { orderBy: { createdAt: "desc" }, take: 5 },
    },
  });

  if (!contract) notFound();

  // Org já está garantida pela query (contractOrgScopeWhere). Falta o escopo
  // POR USUÁRIO (feature Gerente): o editor entrega o HTML do contrato inteiro
  // + histórico de chat + dataJson. 404 sem vazar.
  const effUserId = await getEffectiveUserId(session.user.id);
  const eff = await getEffectivePermissions(effUserId, orgId);
  if (
    !eff ||
    !canAccessDeal({
      effective: eff,
      ownerUserId: contract.deal.userId,
      managerUserId: contract.deal.managerUserId,
    })
  ) {
    notFound();
  }

  const versions = await prisma.contract.findMany({
    // Escopo por kind: o histórico de versões é do MESMO instrumento — sem o
    // filtro, aditamentos/administração apareceriam como "versões" do principal.
    where: { dealId: contract.dealId, kind: contract.kind },
    select: { id: true, version: true, createdAt: true, status: true, isLatest: true },
    orderBy: { version: "desc" },
  });

  const settingsFamily = resolveSettingsFamily({
    contractKind: contract.kind,
    pipelineKind: contract.deal.pipeline?.kind ?? null,
  });
  const orgDefaults =
    settingsFamily === "locacao"
      ? await loadOrgLocacaoDefaults(orgId)
      : await loadOrgContractDefaults(orgId);

  return (
    <ContractEditorPage
      settingsFamily={settingsFamily}
      orgDefaults={orgDefaults}
      contract={{
        id: contract.id,
        dealId: contract.dealId,
        dealTitle: contract.deal.title,
        templateName: contract.template?.name ?? "Contrato importado",
        version: contract.version,
        status: contract.status,
        htmlContent: contract.htmlContent || "",
        dataJson: contract.dataJson as Record<string, unknown>,
        messages: contract.chatSessions[0]?.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          // events: persistido por streamContractAgent pra rehidratar chips
          // de tool_use / tool_result após reload da página.
          events: (m.events as unknown as import("@/lib/ai/types").AgentEvent[]) || undefined,
        })) || [],
        sessionId: contract.chatSessions[0]?.id ?? null,
        exports: contract.exports.map((e) => ({
          id: e.id,
          format: e.format,
          url: e.url,
          createdAt: e.createdAt.toISOString(),
        })),
        googleDocId: contract.googleDocId,
        googleDocUrl: contract.googleDocUrl,
        googleDocStatus: contract.googleDocStatus,
      }}
      versions={versions.map((v) => ({
        id: v.id,
        version: v.version,
        createdAt: v.createdAt.toISOString(),
        status: v.status,
        isLatest: v.isLatest,
      }))}
    />
  );
}
