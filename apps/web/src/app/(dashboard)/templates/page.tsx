import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { PenLine, KeyRound, Library } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { TemplatesListClient } from "@/components/templates/TemplatesListClient";
import { DocumentIngestionDialog } from "@/components/templates/DocumentIngestionDialog";
import { SystemTemplatesPanel } from "@/components/templates/SystemTemplatesPanel";
import { getOrgModules } from "@/lib/modules/read";
import { MODULE_CATALOG, type ModuleKey } from "@/lib/modules/catalog";
import { computeTemplateCoverage } from "@/lib/templates/coverage";

export default async function TemplatesPage({
  searchParams,
}: {
  searchParams?: { archived?: string; ingest?: string };
}) {
  const session = await auth();
  if (!session?.user) return null;

  const org = await getUserOrg(session.user.id);
  if (!org) return <p className="text-muted-foreground p-6">Sem organizacao.</p>;

  const showArchived = searchParams?.archived === "1";

  const templates = await prisma.contractTemplate.findMany({
    where: {
      orgId: org.id,
      status: showArchived ? "archived" : { not: "archived" },
    },
    include: { _count: { select: { contracts: true } } },
    orderBy: [
      { isDefault: "desc" },
      { modalidade: "asc" },
      { createdAt: "desc" },
    ],
  });

  const [archivedCount, modules, activeForCoverage] = await Promise.all([
    prisma.contractTemplate.count({
      where: { orgId: org.id, status: "archived" },
    }),
    getOrgModules(org.id),
    // A cobertura mede o que a GERAÇÃO enxerga (ativos), independente do filtro
    // "arquivados" da listagem acima.
    prisma.contractTemplate.findMany({
      where: { orgId: org.id, status: "active" },
      select: {
        id: true,
        name: true,
        modalidade: true,
        status: true,
        engine: true,
        sourceHash: true,
      },
    }),
  ]);

  const enabledModules = MODULE_CATALOG.map((m) => m.key).filter(
    (m: ModuleKey) => modules.enabled[m]
  );
  const coverage = computeTemplateCoverage({
    modules: enabledModules,
    templates: activeForCoverage,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Templates de Contrato"
        description="Mande os documentos da sua imobiliária — contratos, propostas e cláusulas, de uma vez. Nós lemos, dizemos o que cada um é e você confirma; modelos parecidos viram um só."
      >
        <DocumentIngestionDialog
          autoOpen={searchParams?.ingest === "1"}
          enabledModules={enabledModules}
        />
        <Button size="sm" variant="ghost" asChild>
          <Link href="/settings/knowledge-base">
            <Library className="mr-1.5 h-4 w-4" />
            Acervo de cláusulas
          </Link>
        </Button>
        <Button size="sm" variant="ghost" asChild>
          <Link href="/templates/new">
            <PenLine className="mr-1.5 h-4 w-4" />
            Criar do zero (avançado)
          </Link>
        </Button>
        <Button size="sm" variant="ghost" asChild>
          <Link href="/templates/placeholders">
            <KeyRound className="mr-1.5 h-4 w-4" />
            Chaves de auto-preenchimento
          </Link>
        </Button>
      </PageHeader>

      <SystemTemplatesPanel report={coverage} />

      <TemplatesListClient
        templates={templates.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          modalidade: t.modalidade,
          category: t.category,
          matchCriteria: t.matchCriteria,
          version: t.version,
          isDefault: t.isDefault,
          status: t.status,
          engine: t.engine,
          contractsCount: t._count.contracts,
          updatedAt: t.updatedAt.toISOString(),
        }))}
        showArchived={showArchived}
        archivedCount={archivedCount}
      />
    </div>
  );
}
