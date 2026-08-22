import { redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { getOrgModules, isModuleEnabled } from "@/lib/modules/read";
import { MODULE } from "@/lib/modules/catalog";
import { getEffectiveUserId } from "@/lib/auth/impersonation";
import { getEffectivePermissions, dealScopeWhere } from "@/lib/security/rbac/check";
import { Card, CardContent } from "@/components/ui/card";
import { KanbanBoard } from "@/components/pipeline/KanbanBoard";
import { NovoNegocioLocacaoDropdown } from "@/components/locacao/NovoNegocioLocacaoDropdown";
import { BarChart3, DollarSign, Building2 } from "lucide-react";
import { getBoardStages, getBoardKpis } from "@/lib/pipeline/board-query";
import { parseBoardFilters } from "@/lib/pipeline/list-filters";
import { getResponsavelOptions } from "@/lib/pipeline/responsaveis";
import { PipelineFilters } from "@/components/pipeline/PipelineFilters";

export const dynamic = "force-dynamic";

/**
 * Os stages de locação guardam a cor como nome ("indigo", "amber"…); o board
 * espera um valor CSS/hex pra barra superior da coluna. Mesma paleta de vendas.
 */
const STAGE_COLOR_HEX: Record<string, string> = {
  indigo: "#6366f1",
  amber: "#f59e0b",
  yellow: "#eab308",
  blue: "#3b82f6",
  sky: "#0ea5e9",
  purple: "#a855f7",
  green: "#22c55e",
  red: "#ef4444",
};

export default async function PipelineLocacaoPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/");

  // Filtros server-side da URL (mesma barra de vendas — list-filters.ts).
  const filters = parseBoardFilters(searchParams);

  // Guard de módulo: org sem locação habilitada não acessa o pipeline de locação.
  const modules = await getOrgModules(org.id);
  if (!isModuleEnabled(modules, MODULE.LOCACAO)) redirect("/pipeline");

  // Escopo por usuário (feature Gerente) — id efetivo respeita impersonation,
  // espelhando requireFeaturePage do kanban de vendas.
  const effUserId = await getEffectiveUserId(session.user.id);
  const eff = await getEffectivePermissions(effUserId, org.id);
  const dealScope = dealScopeWhere(eff) ?? { id: "__none__" };

  // nowMs único pro render — cards, board e filtros de SLA derivam dele (#418).
  const nowMs = Date.now();
  const board = await getBoardStages({
    orgId: org.id,
    kind: "locacao",
    filters,
    extraWhere: { kind: "locacao", ...dealScope },
    orderBy: { createdAt: "desc" },
    nowMs,
  });

  if (!board) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-sm text-muted-foreground">
            Pipeline de locação não inicializada. Rode{" "}
            <code className="mx-1 rounded bg-muted px-1.5 py-0.5">
              pnpm tsx apps/web/scripts/seed-pipeline-locacao.ts --apply --orgId={org.id}
            </code>{" "}
            para criar os 6 stages.
          </p>
        </CardContent>
      </Card>
    );
  }

  // KPIs da ORG via aggregate — visão default (sem arquivados), independem
  // dos filtros da URL e do cap por coluna.
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const [kpis, responsaveis] = await Promise.all([
    getBoardKpis(
      {
        pipelineId: board.pipelineId,
        kind: "locacao",
        archivedAt: null,
        ...dealScope,
      },
      startOfToday
    ),
    getResponsavelOptions({ orgId: org.id, pipelineId: board.pipelineId }),
  ]);

  const stageIdByName = new Map(board.stages.map((s) => [s.name, s.id]));
  const countFor = (name: string) =>
    kpis.byStageId[stageIdByName.get(name) ?? ""]?.count ?? 0;
  const graduatedDeals = countFor("ADM");
  const lostDeals = countFor("Negócio perdido");
  const activeDeals = kpis.totalDeals - graduatedDeals - lostDeals;
  const totalValue = kpis.totalValue;
  const dealsToday = kpis.dealsToday;
  const ticketMedio = kpis.dealsWithValue > 0 ? totalValue / kpis.dealsWithValue : 0;
  const fmtBRLShort = (v: number) =>
    v >= 1_000_000
      ? `R$ ${(v / 1_000_000).toFixed(1)}M`
      : v >= 1000
        ? `R$ ${(v / 1000).toFixed(0)}k`
        : `R$ ${v.toFixed(0)}`;

  const stages = board.stages.map((stage) => ({
    id: stage.id,
    name: stage.name,
    color: STAGE_COLOR_HEX[stage.color ?? ""] ?? stage.color ?? "#6366f1",
    deals: stage.deals,
    total: stage.total,
  }));

  // CTAs de criação (locação tem fluxos próprios: form público + wizard).
  const [properties, tenants] = await Promise.all([
    prisma.property.findMany({
      where: { orgId: org.id, status: { in: ["disponivel", "anunciado", "em_negociacao"] } },
      select: { id: true, rua: true, numero: true, cidade: true, uf: true },
      take: 100,
      orderBy: { updatedAt: "desc" },
    }),
    prisma.tenant.findMany({
      where: { orgId: org.id },
      select: { id: true, nome: true, cpfCnpj: true },
      take: 100,
      orderBy: { updatedAt: "desc" },
    }),
  ]);
  const propertyOptions = properties.map((p) => ({
    id: p.id,
    label: `${p.rua ?? ""} ${p.numero ?? ""} — ${p.cidade ?? ""}/${p.uf ?? ""}`.trim(),
  }));
  const tenantOptions = tenants.map((t) => ({ id: t.id, label: `${t.nome} (${t.cpfCnpj})` }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Pipeline de Locação
        </h1>
        <NovoNegocioLocacaoDropdown
          properties={propertyOptions}
          tenants={tenantOptions}
        />
      </div>

      {/* Metrics — KPI cards (mesmo layout de vendas) */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:max-w-4xl">
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <BarChart3 className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-bold tabular-nums">{activeDeals}</p>
              <p className="text-xs text-muted-foreground">
                Negócios ativos
                {dealsToday > 0 && (
                  <span className="ml-1.5 font-medium text-success">
                    +{dealsToday} hoje
                  </span>
                )}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-success/10">
              <DollarSign className="h-5 w-5 text-success" />
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-bold tabular-nums">
                {fmtBRLShort(totalValue)}
              </p>
              <p className="text-xs text-muted-foreground">
                Valor em pipeline
                {ticketMedio > 0 && (
                  <span className="ml-1.5">
                    · Ticket médio {fmtBRLShort(ticketMedio)}
                  </span>
                )}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-info/10">
              <Building2 className="h-5 w-5 text-info" />
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-bold tabular-nums">{graduatedDeals}</p>
              <p className="text-xs text-muted-foreground">
                Graduados p/ ADM
                {activeDeals > 0 && (
                  <span className="ml-1.5">· {activeDeals} em andamento</span>
                )}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filtros server-side — mesma barra de vendas */}
      <PipelineFilters
        filters={filters}
        responsaveis={responsaveis}
        totals={board.totals}
      />

      {/* Kanban — mesmo board de vendas, config de locação */}
      <KanbanBoard
        stages={stages}
        nowMs={nowMs}
        hideToolbar
        config={{
          basePath: "/locacao/deals",
          timelineKind: "locacao",
          lostStageName: "Negócio perdido",
          milestoneFields: {
            Assinado: {
              cardKey: "contractSignedAt",
              apiField: "contractSignedAt",
              label: "assinatura do contrato",
            },
            "Cobrança Gerada": {
              cardKey: "chargeCreatedAt",
              apiField: "chargeIssuedAt",
              label: "emissão da cobrança",
            },
          },
        }}
      />
    </div>
  );
}
