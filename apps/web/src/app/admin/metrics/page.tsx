import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AiMetricsClient } from "./AiMetricsClient";
import { ApiMetricsClient, AuditMetricsClient } from "./ApiAuditClients";

export const dynamic = "force-dynamic";
export const metadata = { title: "Métricas — Admin" };

/**
 * Relatórios cross-tenant que não pertencem a um agente ou tenant específico:
 * custo de IA (com linha Plataforma e grupo Infraestrutura), uso de API/MCP
 * (o sidecar entra como bearer) e o rollup do AuditLog que nunca existiu.
 *
 * Gate de PlatformRole no layout do /admin; cada API impõe o dela.
 */
export default function AdminMetricsPage() {
  return (
    <div className="mx-auto max-w-5xl p-6">
      <header className="mb-6">
        <h1 className="font-display text-2xl font-semibold">Métricas</h1>
        <p className="text-sm text-muted-foreground">
          Visão do sistema inteiro — todos os tenants + plataforma. Custo por
          tenant de ClickSign/Asaas/Certidões continua na visão geral de{" "}
          <a href="/admin/orgs" className="underline">
            Organizações
          </a>
          .
        </p>
      </header>
      <Tabs defaultValue="ia">
        <TabsList>
          <TabsTrigger value="ia">IA</TabsTrigger>
          <TabsTrigger value="api">API / MCP</TabsTrigger>
          <TabsTrigger value="audit">Auditoria</TabsTrigger>
        </TabsList>
        <TabsContent value="ia" className="pt-4">
          <AiMetricsClient />
        </TabsContent>
        <TabsContent value="api" className="pt-4">
          <ApiMetricsClient />
        </TabsContent>
        <TabsContent value="audit" className="pt-4">
          <AuditMetricsClient />
        </TabsContent>
      </Tabs>
    </div>
  );
}
