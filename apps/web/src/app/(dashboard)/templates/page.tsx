import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { PenLine } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { TemplatesListClient } from "@/components/templates/TemplatesListClient";
import { UploadModeloDialog } from "@/components/templates/UploadModeloDialog";

export default async function TemplatesPage({
  searchParams,
}: {
  searchParams?: { archived?: string };
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

  const archivedCount = await prisma.contractTemplate.count({
    where: { orgId: org.id, status: "archived" },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Templates de Contrato"
        description="Comece pelo modelo timbrado da sua imobiliária (.docx) — a IA insere as variáveis e você revisa. Cada modalidade tem um template padrão, usado automaticamente nos novos contratos."
      >
        <UploadModeloDialog />
        <Button size="sm" variant="ghost" asChild>
          <Link href="/templates/new">
            <PenLine className="mr-1.5 h-4 w-4" />
            Criar do zero (avançado)
          </Link>
        </Button>
      </PageHeader>

      <TemplatesListClient
        templates={templates.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          modalidade: t.modalidade,
          category: t.category,
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
