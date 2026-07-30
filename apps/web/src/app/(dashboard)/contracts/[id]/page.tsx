import { notFound } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { getEffectiveUserId } from "@/lib/auth/impersonation";
import { prisma } from "@/lib/db/prisma";
import { ContractEditorPage } from "@/components/contracts/ContractEditorPage";
import { getEffectivePermissions, canAccessDeal } from "@/lib/security/rbac/check";

export default async function ContractPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await auth();
  if (!session?.user?.id) return null;
  const org = await getUserOrg(session.user.id);
  if (!org) notFound();

  const contract = await prisma.contract.findUnique({
    where: { id: params.id },
    include: {
      deal: {
        select: {
          id: true,
          title: true,
          userId: true,
          managerUserId: true,
          pipeline: { select: { orgId: true } },
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

  // Cross-org + escopo por usuário (feature Gerente): o editor entrega o HTML
  // do contrato inteiro + histórico de chat + dataJson — a org vem do DEAL
  // (contrato importado tem template null; ver CLAUDE.md). 404 sem vazar.
  if (contract.deal.pipeline.orgId !== org.id) notFound();
  const effUserId = await getEffectiveUserId(session.user.id);
  const eff = await getEffectivePermissions(effUserId, org.id);
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

  return (
    <ContractEditorPage
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
