import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { PenLine, KeyRound, Library, ClipboardCheck } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { TemplatesListClient } from "@/components/templates/TemplatesListClient";
import { DocumentIngestionDialog } from "@/components/templates/DocumentIngestionDialog";
import { ContractTypesPanel } from "@/components/templates/ContractTypesPanel";
import { StartIngestionRunButton } from "@/components/templates/StartIngestionRunButton";
import { getOrgModules } from "@/lib/modules/read";
import { MODULE_CATALOG, type ModuleKey } from "@/lib/modules/catalog";
import {
  assignedTemplateIds,
  computeGarantiaBoard,
  computeTemplateCoverage,
  gapsBySection,
} from "@/lib/templates/coverage";
import {
  providersByGarantiaFromTags,
  slotTag,
} from "@/lib/templates/clause-slots";
import { modalidadeLabel } from "@/lib/contracts/template-category";
import { isIngestionEnabled } from "@/lib/ingestion/guard";

/**
 * /templates em DUAS abas (decisão de produto, 28/08):
 *
 *   Tipos de contrato (padrão) — o que o sistema espera: uma linha por tipo,
 *     com o modelo padrão atribuído ou o estado faltante/sem padrão. Não é
 *     repositório: nenhuma listagem completa aqui.
 *   Modelos — o repositório: listagem completa, enviar acervo/documento, criar
 *     do zero, tornar padrão, arquivar.
 *
 * `?ingest=1` e `?archived=1` forçam a aba Modelos: são links antigos
 * (onboarding, acervo de cláusulas) que apontam direto pra ação de repositório.
 */
export default async function TemplatesPage({
  searchParams,
}: {
  searchParams?: {
    tab?: string;
    archived?: string;
    ingest?: string;
    modalidade?: string;
  };
}) {
  const session = await auth();
  if (!session?.user) return null;

  const org = await getUserOrg(session.user.id);
  if (!org) return <p className="text-muted-foreground p-6">Sem organizacao.</p>;

  const showArchived = searchParams?.archived === "1";
  const autoIngest = searchParams?.ingest === "1";
  const repoTab =
    searchParams?.tab === "modelos" || autoIngest || showArchived;
  const modalidadeFilter = searchParams?.modalidade || null;

  const [modules, notArchived, slotClauses, openRun] = await Promise.all([
    getOrgModules(org.id),
    // Alimenta as DUAS coberturas da aba Tipos: o painel (que filtra ativos
    // internamente) e a matriz de garantias (que enxerga rascunho de propósito
    // — o run de ingestão nasce suggest-only).
    prisma.contractTemplate.findMany({
      where: { orgId: org.id, status: { not: "archived" } },
      select: {
        id: true,
        name: true,
        modalidade: true,
        status: true,
        engine: true,
        isDefault: true,
        sourceHash: true,
        matchCriteria: true,
      },
    }),
    // Sublinha "Seguradoras no acervo" das linhas de garantia: cláusulas
    // aprovadas do slot, agrupadas por tipo depois (função pura).
    prisma.knowledgeItem.findMany({
      where: {
        orgId: org.id,
        category: "clause",
        status: "approved",
        tags: { hasSome: [slotTag("garantia")] },
      },
      select: { tags: true },
    }),
    // Lote em andamento: sem esta faixa, quem fecha a aba durante a ingestão
    // perde a URL da conferência e o lote fica esperando para sempre.
    prisma.ingestionRun.findFirst({
      where: { orgId: org.id, status: { notIn: ["done", "failed", "cancelled"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, itemsTotal: true, itemsDone: true },
    }),
  ]);

  const enabledModules = MODULE_CATALOG.map((m) => m.key).filter(
    (m: ModuleKey) => modules.enabled[m]
  );
  const ingestionEnabled = await isIngestionEnabled(org.id);
  const coverage = computeTemplateCoverage({
    modules: enabledModules,
    templates: notArchived,
  });
  const board = computeGarantiaBoard({
    modules: enabledModules,
    templates: notArchived,
  });
  const providersByGarantia = providersByGarantiaFromTags(slotClauses);
  // Fonte única do "verde" do repositório: os mesmos ids que a aba Tipos
  // exibe como padrão/atribuído.
  const assigned = assignedTemplateIds(coverage, board);
  const sectionGaps = gapsBySection(coverage, board);

  const templates = repoTab
    ? await prisma.contractTemplate.findMany({
        where: {
          orgId: org.id,
          status: showArchived ? "archived" : { not: "archived" },
          ...(modalidadeFilter ? { modalidade: modalidadeFilter } : {}),
        },
        include: { _count: { select: { contracts: true } } },
        orderBy: [
          { isDefault: "desc" },
          { modalidade: "asc" },
          { createdAt: "desc" },
        ],
      })
    : [];

  const archivedCount = repoTab
    ? await prisma.contractTemplate.count({
        where: {
          orgId: org.id,
          status: "archived",
          ...(modalidadeFilter ? { modalidade: modalidadeFilter } : {}),
        },
      })
    : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Templates de Contrato"
        description="Cada tipo de contrato tem um modelo padrão — é ele que gera o documento."
      >
        {/*
          No cabeçalho, e não na barra de ações da aba "Modelos": a conferência
          da biblioteca é a pergunta que se faz ANTES de escolher uma aba, e
          enterrá-la numa delas foi exatamente como o botão "Revisar" de cada
          modelo passou despercebido.
        */}
        <Button size="sm" variant="outline" asChild>
          <Link href="/templates/revisao">
            <ClipboardCheck className="mr-1.5 h-4 w-4" />
            Revisar biblioteca
          </Link>
        </Button>
      </PageHeader>

      {openRun && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-violet-300 bg-violet-50/50 p-3 text-sm dark:border-violet-900 dark:bg-violet-950/20">
          <span className="min-w-0 flex-1">
            {openRun.status === "awaiting_review"
              ? "Um envio está esperando a sua conferência — nada entra na biblioteca antes de você confirmar."
              : `Estamos lendo os arquivos do seu último envio (${openRun.itemsDone} de ${openRun.itemsTotal}).`}
          </span>
          <Button size="sm" variant="outline" asChild>
            <Link href={`/templates/ingestion/${openRun.id}`}>
              {openRun.status === "awaiting_review" ? "Conferir agora" : "Acompanhar"}
            </Link>
          </Button>
        </div>
      )}

      <nav className="flex gap-1 border-b" aria-label="Seções de templates">
        <TabLink href="/templates" active={!repoTab}>
          Tipos de contrato
        </TabLink>
        <TabLink href="/templates?tab=modelos" active={repoTab}>
          Modelos
        </TabLink>
      </nav>

      {!repoTab ? (
        <ContractTypesPanel
          report={coverage}
          board={board}
          providersByGarantia={providersByGarantia}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {ingestionEnabled && (
              <StartIngestionRunButton
                orgId={org.id}
                label="Enviar acervo de uma vez"
              />
            )}
            <DocumentIngestionDialog
              autoOpen={autoIngest}
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
          </div>

          {modalidadeFilter && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">
                Mostrando só{" "}
                <span className="font-medium text-foreground">
                  {modalidadeLabel(modalidadeFilter)}
                </span>
                {" — marque um como padrão ou envie um modelo novo."}
              </span>
              <Button size="sm" variant="ghost" asChild>
                <Link href="/templates?tab=modelos">Ver todos</Link>
              </Button>
            </div>
          )}

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
            modalidadeFilter={modalidadeFilter}
            assignedIds={[...assigned]}
            gaps={sectionGaps}
          />
        </>
      )}
    </div>
  );
}

function TabLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={
        active
          ? "-mb-px border-b-2 border-primary px-3 py-2 text-sm font-medium text-foreground"
          : "-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
      }
    >
      {children}
    </Link>
  );
}
