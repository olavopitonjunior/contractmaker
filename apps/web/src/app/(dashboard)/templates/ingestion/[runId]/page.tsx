import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { getEffectiveUserId } from "@/lib/auth/impersonation";
import { prisma } from "@/lib/db/prisma";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { IngestionReviewClient } from "@/components/templates/IngestionReviewClient";

export const dynamic = "force-dynamic";

/**
 * Conferência de um lote de ingestão.
 *
 * A tela onde a decisão do planner vira (ou não) biblioteca da imobiliária: o
 * operador vê modelo por modelo e cláusula por cláusula, desmarca o que estiver
 * errado e só então manda aplicar.
 *
 * Lote inexistente, lote de OUTRA imobiliária e usuário sem papel de
 * owner/admin dão o MESMO `notFound()` — a página não pode confirmar a
 * existência de um lote alheio a quem adivinhar um id.
 */
export default async function IngestionRunPage({
  params,
}: {
  params: { runId: string };
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const org = await getUserOrg(session.user.id);
  if (!org) notFound();

  const userId = await getEffectiveUserId(session.user.id);
  const membership = await prisma.orgMembership.findFirst({
    where: { userId, orgId: org.id },
    select: { role: true },
  });
  if (!membership || !["owner", "admin"].includes(membership.role)) notFound();

  const run = await prisma.ingestionRun.findFirst({
    where: { id: params.runId, orgId: org.id },
    select: {
      id: true,
      trigger: true,
      status: true,
      itemsTotal: true,
      itemsDone: true,
      libraryPlan: true,
      planReviewed: true,
      report: true,
      error: true,
      aiCostUsd: true,
      items: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          filename: true,
          fileKind: true,
          status: true,
          error: true,
          blobUrl: true,
          classification: true,
        },
      },
    },
  });
  if (!run) notFound();

  // `Decimal` do Prisma não atravessa a fronteira server→client component.
  const snapshot = {
    ...run,
    aiCostUsd: run.aiCostUsd === null ? null : Number(run.aiCostUsd),
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Conferir o envio dos seus modelos"
        description="Só o que ficar marcado entra na biblioteca — e entra como rascunho."
      >
        <Button size="sm" variant="ghost" asChild>
          <Link href="/templates">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Voltar aos modelos
          </Link>
        </Button>
      </PageHeader>

      <IngestionReviewClient initialRun={snapshot} orgId={org.id} />
    </div>
  );
}
