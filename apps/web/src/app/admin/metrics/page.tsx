import { AiMetricsClient } from "./AiMetricsClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Métricas — Admin" };

/**
 * Relatórios cross-tenant que não pertencem a um agente ou tenant específico.
 * Primeira entrega: custo de IA por agente/modelo/operação/org, incluindo a
 * linha Plataforma e o grupo Infraestrutura. API/auditoria/acessos entram nas
 * fatias seguintes do plano.
 *
 * Gate de PlatformRole no layout do /admin; a API (/api/admin/metrics/ai)
 * impõe o dela.
 */
export default function AdminMetricsPage() {
  return (
    <div className="mx-auto max-w-5xl p-6">
      <header className="mb-6">
        <h1 className="font-display text-2xl font-semibold">Métricas</h1>
        <p className="text-sm text-muted-foreground">
          Custo de IA no sistema inteiro — todos os tenants + plataforma. Custo
          por tenant de ClickSign/Asaas/Certidões continua na visão geral de{" "}
          <a href="/admin/orgs" className="underline">
            Organizações
          </a>
          .
        </p>
      </header>
      <AiMetricsClient />
    </div>
  );
}
