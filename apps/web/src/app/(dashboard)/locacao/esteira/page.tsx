import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { NovoContratoWizard } from "@/components/locacao/NovoContratoWizard";
import { NovoFormularioLocacaoDialog } from "@/components/locacao/NovoFormularioLocacaoDialog";
import { KanbanDealCard } from "@/components/locacao/KanbanDealCard";

export const dynamic = "force-dynamic";

// Cores por stage (espelham o spec §4.3 D1).
const STAGE_COLOR: Record<string, string> = {
  "Análise de Crédito": "bg-indigo-50 dark:bg-indigo-950/30 border-indigo-200 dark:border-indigo-800",
  "Aprovação": "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800",
  "Confecção de Contrato": "bg-yellow-50 dark:bg-yellow-950/30 border-yellow-200 dark:border-yellow-800",
  "Em Assinatura": "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800",
  "Vistoria de Entrada": "bg-sky-50 dark:bg-sky-950/30 border-sky-200 dark:border-sky-800",
  "Chaves Entregues": "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800",
};

export default async function LocacaoEsteiraPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/");

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
              form: { select: { dataJson: true } },
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
            Pipeline de locação não inicializada. Rode <code className="mx-1 rounded bg-muted px-1.5 py-0.5">pnpm tsx apps/web/scripts/seed-pipeline-locacao.ts --apply --orgId={org.id}</code> para criar os 6 stages (D1).
          </p>
        </CardContent>
      </Card>
    );
  }

  const totalDeals = pipeline.stages.reduce((acc, s) => acc + s.deals.length, 0);

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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Esteira de Locação</h2>
          <p className="text-sm text-muted-foreground">
            Kanban com {pipeline.stages.length} stages · {totalDeals} deals em andamento. Lead/Visita/Proposta ficam fora (decisão D1).
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Criação do formulário público (form → contrato → assinatura).
              Essencial no modo simplificado, onde a aba Contratos fica oculta. */}
          <NovoFormularioLocacaoDialog />
          <NovoContratoWizard properties={propertyOptions} tenants={tenantOptions} />
        </div>
      </div>

      <div className="grid auto-cols-[280px] grid-flow-col gap-3 overflow-x-auto pb-3">
        {pipeline.stages.map((stage) => (
          <div key={stage.id} className={`flex flex-col rounded-md border ${STAGE_COLOR[stage.name] ?? "bg-muted/30"}`}>
            <div className="flex items-center justify-between border-b border-current/20 px-3 py-2">
              <div className="font-medium text-sm">{stage.name}</div>
              <Badge variant="secondary">{stage.deals.length}</Badge>
            </div>
            <div className="flex-1 space-y-2 p-2">
              {stage.deals.length === 0 ? (
                <div className="rounded border border-dashed border-current/20 p-4 text-center text-xs text-muted-foreground">
                  Nenhum deal
                </div>
              ) : (
                stage.deals.map((deal) => {
                  const data = (deal.form?.dataJson ?? {}) as Record<string, unknown>;
                  const locatarios = Array.isArray(data.locatario)
                    ? (data.locatario as Array<{ nome?: string; razao_social?: string }>)
                    : [];
                  const tenantName = locatarios[0]?.nome ?? locatarios[0]?.razao_social ?? null;
                  const imovel = data.imovel as
                    | { rua?: string; numero?: string; cidade?: string }
                    | undefined;
                  const imovelEndereco = imovel
                    ? `${imovel.rua ?? ""} ${imovel.numero ?? ""}`.trim() || null
                    : null;
                  return (
                    <KanbanDealCard
                      key={deal.id}
                      deal={{
                        id: deal.id,
                        title: deal.title,
                        value: deal.value,
                        stageId: stage.id,
                      }}
                      imovelEndereco={imovelEndereco}
                      tenantName={tenantName}
                      stages={pipeline.stages.map((s) => ({ id: s.id, name: s.name }))}
                    />
                  );
                })
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
