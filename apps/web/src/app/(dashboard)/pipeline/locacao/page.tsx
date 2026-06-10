import { redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { getOrgModules, isModuleEnabled } from "@/lib/modules/read";
import { MODULE } from "@/lib/modules/catalog";
import { Card, CardContent } from "@/components/ui/card";
import { KanbanBoard } from "@/components/pipeline/KanbanBoard";
import { NovoNegocioLocacaoDropdown } from "@/components/locacao/NovoNegocioLocacaoDropdown";
import { BarChart3, DollarSign, Building2 } from "lucide-react";

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

/** Extrai o nome do 1º locatário do dataJson do form (best-effort, null-safe). */
function extractTenantName(dataJson: unknown): string | null {
  if (!dataJson || typeof dataJson !== "object") return null;
  const locatarios = (dataJson as { locatarios?: unknown }).locatarios;
  if (!Array.isArray(locatarios) || locatarios.length === 0) return null;
  const first = locatarios[0] as { nome?: unknown; razao_social?: unknown };
  const nome =
    (typeof first?.nome === "string" && first.nome.trim()) ||
    (typeof first?.razao_social === "string" && first.razao_social.trim()) ||
    null;
  return nome || null;
}

export default async function PipelineLocacaoPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/");

  // Guard de módulo: org sem locação habilitada não acessa o pipeline de locação.
  const modules = await getOrgModules(org.id);
  if (!isModuleEnabled(modules, MODULE.LOCACAO)) redirect("/pipeline");

  const pipeline = await prisma.pipeline.findFirst({
    where: { orgId: org.id, kind: "locacao" },
    include: {
      stages: {
        orderBy: { position: "asc" },
        include: {
          deals: {
            where: { kind: "locacao" },
            orderBy: { createdAt: "desc" },
            include: {
              form: {
                select: {
                  id: true,
                  status: true,
                  token: true,
                  createdAt: true,
                  completedAt: true,
                  dataJson: true,
                },
              },
              contracts: {
                where: { isLatest: true },
                select: { id: true, version: true },
              },
              envelopes: {
                where: { source: "contract", status: "closed" },
                select: { closedAt: true },
                orderBy: { closedAt: "desc" },
                take: 1,
              },
              commissionCharges: {
                select: { createdAt: true },
                orderBy: { createdAt: "asc" },
                take: 1,
              },
            },
          },
        },
      },
    },
  });

  if (!pipeline) {
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

  const allDeals = pipeline.stages.flatMap((s) => s.deals);
  const admStage = pipeline.stages.find((s) => s.name === "ADM");
  const lostStage = pipeline.stages.find((s) => s.name === "Negócio perdido");
  const graduatedDeals = admStage?.deals.length ?? 0;
  const lostDeals = lostStage?.deals.length ?? 0;
  const activeDeals = allDeals.length - graduatedDeals - lostDeals;
  const totalValue = allDeals.reduce((sum, d) => sum + (d.value || 0), 0);

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const dealsToday = allDeals.filter(
    (d) => d.createdAt.getTime() >= startOfToday.getTime()
  ).length;
  const dealsWithValue = allDeals.filter((d) => (d.value || 0) > 0).length;
  const ticketMedio = dealsWithValue > 0 ? totalValue / dealsWithValue : 0;
  const fmtBRLShort = (v: number) =>
    v >= 1_000_000
      ? `R$ ${(v / 1_000_000).toFixed(1)}M`
      : v >= 1000
        ? `R$ ${(v / 1000).toFixed(0)}k`
        : `R$ ${v.toFixed(0)}`;

  const stages = pipeline.stages.map((stage) => ({
    id: stage.id,
    name: stage.name,
    color: STAGE_COLOR_HEX[stage.color ?? ""] ?? stage.color ?? "#6366f1",
    deals: stage.deals.map((deal) => ({
      id: deal.id,
      title: deal.title,
      value: deal.value,
      createdAt: deal.createdAt.toISOString(),
      clientName: extractTenantName(deal.form?.dataJson),
      formStatus: deal.form?.status || null,
      formToken: deal.form?.token || null,
      hasContract: deal.contracts.length > 0,
      formOpenedAt: deal.form?.createdAt?.toISOString() ?? null,
      formCompletedAt: deal.form?.completedAt?.toISOString() ?? null,
      contractSignedAt:
        deal.envelopes[0]?.closedAt?.toISOString() ??
        deal.contractSignedAt?.toISOString() ??
        null,
      chargeCreatedAt:
        deal.commissionCharges[0]?.createdAt.toISOString() ??
        deal.chargeIssuedAt?.toISOString() ??
        null,
      commissionPaidAt: deal.commissionPaidAt?.toISOString() ?? null,
      lostAt: deal.lostAt?.toISOString() ?? null,
      lostReason: deal.lostReason ?? null,
    })),
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

      {/* Kanban — mesmo board de vendas, config de locação */}
      <KanbanBoard
        stages={stages}
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
