import Link from "next/link";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Wallet, CheckCircle2, XCircle, Clock, AlertTriangle, ShieldCheck, ShieldAlert, ExternalLink } from "lucide-react";
import { endpointInfo } from "@/lib/certidoes/endpoints";
import { checkGovBrAuth } from "@/lib/certidoes/govbr-auth";
import { checkOnrAuth } from "@/lib/certidoes/onr-auth";
import { mapInfosimplesCodeToCategory, CATEGORY_LABEL } from "@/lib/certidoes/error-codes";
import { CertidoesMonitorClient, type ProblemRow } from "@/components/settings/CertidoesMonitorClient";

export const dynamic = "force-dynamic";

function p50(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.5)];
}

function p95(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1];
}

function brl(cents: number): string {
  return `R$ ${(cents / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default async function CertidoesSettingsPage() {
  const session = await auth();
  if (!session?.user) return null;
  const org = await getUserOrg(session.user.id);
  if (!org) return null;

  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const last30 = new Date(now.getTime() - 30 * 24 * 60 * 60_000);

  // Jobs da org: de deal (via form.orgId) E sem deal (ad-hoc/LeaseClient,
  // orgId direto) — a mesma contagem que bloqueia o disparo
  // (lib/certidoes/budget.ts); antes só os de deal entravam aqui.
  const recent = await prisma.certidaoJob.findMany({
    where: {
      createdAt: { gte: last30 },
      OR: [{ deal: { form: { orgId: org.id } } }, { orgId: org.id }],
    },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: {
      id: true,
      endpoint: true,
      status: true,
      latencyMs: true,
      costCents: true,
      errorMessage: true,
      createdAt: true,
      label: true,
      dealId: true,
      resultCode: true,
      retryCount: true,
      maxRetries: true,
      portalUrl: true,
    },
  });

  const monthJobs = recent.filter((j) => j.createdAt >= firstOfMonth);
  // Split Infosimples vs Serasa pra exibir os dois budgets sem se confundir.
  // O type do select acima não inclui `provider`, então usamos o prefixo do
  // endpoint como discriminador (todos os Serasa começam com "serasa/").
  const monthJobsInfosimples = monthJobs.filter((j) => !j.endpoint.startsWith("serasa/"));
  const monthJobsSerasa = monthJobs.filter((j) => j.endpoint.startsWith("serasa/"));
  const monthSpend = monthJobsInfosimples.reduce((a, j) => a + (j.costCents ?? 0), 0);
  const monthSpendSerasa = monthJobsSerasa.reduce((a, j) => a + (j.costCents ?? 0), 0);
  // NÃO mostrar o budget aqui: INFOSIMPLES/SERASA_MONTHLY_BUDGET_CENTS são
  // tetos DA PLATAFORMA (env compartilhado entre todos os tenants) — expor o
  // valor e o percentual pra qualquer membro da org vazava um número de infra
  // que não é do tenant. A página mostra só o GASTO da org no mês.

  const totalLast30 = recent.length;
  const successCount = recent.filter((j) => j.status === "success").length;
  const failedCount = recent.filter((j) => j.status === "failed").length;
  const awaitingCount = recent.filter((j) => j.status === "awaiting_portal").length;
  const successRate =
    totalLast30 > 0 ? Math.round((successCount / totalLast30) * 100) : 0;

  // Per-endpoint stats
  const byEndpoint = new Map<
    string,
    {
      total: number;
      success: number;
      failed: number;
      latencies: number[];
    }
  >();
  for (const j of recent) {
    if (!byEndpoint.has(j.endpoint)) {
      byEndpoint.set(j.endpoint, { total: 0, success: 0, failed: 0, latencies: [] });
    }
    const bucket = byEndpoint.get(j.endpoint)!;
    bucket.total++;
    if (j.status === "success") bucket.success++;
    if (j.status === "failed") bucket.failed++;
    if (j.latencyMs != null) bucket.latencies.push(j.latencyMs);
  }
  const endpointRows = Array.from(byEndpoint.entries())
    .map(([endpoint, s]) => ({
      endpoint,
      label: endpointInfo(endpoint).label,
      total: s.total,
      success: s.success,
      failed: s.failed,
      successRate: s.total > 0 ? Math.round((s.success / s.total) * 100) : 0,
      p50ms: p50(s.latencies),
      p95ms: p95(s.latencies),
    }))
    .sort((a, b) => b.total - a.total);

  // Recent errors (top 10 most recent failures)
  const recentErrors = recent
    .filter((j) => j.status === "failed" && j.errorMessage)
    .slice(0, 10);

  // --- Saúde da API + crédito (últimas 24h) ---
  const last24 = new Date(now.getTime() - 24 * 60 * 60_000);
  const recent24 = recent.filter((j) => j.createdAt >= last24);
  // Crédito Infosimples esgotado é sinalizado in-band por 603/604 ("limite de
  // uso"). Não há API de saldo — esse é o gatilho de alerta.
  const creditExhausted = recent24.some(
    (j) => j.resultCode === 603 || j.resultCode === 604
  );
  const pausedSpike = recent24.filter((j) => j.resultCode === 615).length;

  // --- Relatório de problemas (falhas terminais em aberto) ---
  const problemStatuses = new Set([
    "failed_permanent",
    "failed",
    "data_missing",
    "data_invalid",
  ]);
  const problems: ProblemRow[] = recent
    .filter((j) => problemStatuses.has(j.status))
    .slice(0, 100)
    .map((j) => {
      const category =
        j.resultCode != null && j.resultCode !== 200
          ? mapInfosimplesCodeToCategory(j.resultCode, j.errorMessage)
          : null;
      return {
        id: j.id,
        dealId: j.dealId,
        label: j.label,
        endpoint: j.endpoint,
        status: j.status,
        resultCode: j.resultCode,
        errorMessage: j.errorMessage,
        retryCount: j.retryCount ?? 0,
        maxRetries: j.maxRetries ?? 3,
        categoryLabel: category ? CATEGORY_LABEL[category] : null,
        portalUrl: j.portalUrl,
      };
    });

  // Phase F.II-γ — status da autenticação GOV.BR na conta Infosimples.
  // Afeta quais endpoints ficam disponíveis (CENPROT nacional etc).
  const govbr = await checkGovBrAuth();

  // ONR/ARISP (Registradores) — presença de credencial (env). O teste de login
  // AO VIVO fica no botão "Testar login ONR" (gasta ~R$0,04); aqui é só o estado
  // estático pra não custar a cada page-load.
  const onr = await checkOnrAuth();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/settings">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Configurações
          </Link>
        </Button>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Certidões — Qualidade & Custos</h1>
      </div>

      {/* Phase F.II-γ — status da autenticação GOV.BR (conta Infosimples) */}
      <Card className={govbr.active ? "border-green-300" : "border-amber-300 bg-amber-50/30"}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            {govbr.active ? (
              <>
                <ShieldCheck className="h-4 w-4 text-green-600" />
                Autenticação GOV.BR ativa
              </>
            ) : (
              <>
                <ShieldAlert className="h-4 w-4 text-amber-600" />
                Autenticação GOV.BR inativa
              </>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-1">
          {govbr.active && govbr.session ? (
            <>
              <p>
                <span className="text-muted-foreground">Tipo:</span>{" "}
                <span className="font-medium">{govbr.session.type}</span> ·{" "}
                <span className="text-muted-foreground">Identificador:</span>{" "}
                <span className="font-mono">{govbr.session.identifier}</span>
              </p>
              <p className="text-muted-foreground">
                Expira em: <span className="font-medium">{govbr.session.expires_at}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                Endpoints habilitados por esta autenticação: CENPROT Nacional (IEPTB).
              </p>
            </>
          ) : (
            <>
              <p className="text-amber-900">
                {govbr.error ?? "Nenhuma sessão GOV.BR encontrada."}
              </p>
              <p className="text-xs text-muted-foreground">
                Sem GOV.BR ativo, endpoints que exigem autenticação (CENPROT Nacional)
                serão pulados. Renove a autenticação em duas etapas no portal Infosimples.
              </p>
              <a
                href="https://portal.infosimples.com/autenticacao-govbr"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline mt-1"
              >
                Abrir portal Infosimples <ExternalLink className="h-3 w-3" />
              </a>
            </>
          )}
        </CardContent>
      </Card>

      {/* Status ONR/ARISP (Registradores) — habilita matrícula + pesquisa de bens */}
      <Card className={onr.active ? "border-green-300" : "border-amber-300 bg-amber-50/30"}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            {onr.active ? (
              <>
                <ShieldCheck className="h-4 w-4 text-green-600" />
                Credencial ONR/ARISP configurada
              </>
            ) : (
              <>
                <ShieldAlert className="h-4 w-4 text-amber-600" />
                Credencial ONR/ARISP ausente
              </>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-1">
          {onr.active ? (
            <>
              <p>
                <span className="text-muted-foreground">Modo:</span>{" "}
                <span className="font-medium">
                  {onr.mode === "cert_a1" ? "Certificado A1" : "Login e senha"}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                Habilita matrícula (inteiro teor) e pesquisa de bens (Mapa do Registro).
                Clique em <strong>Testar login ONR</strong> abaixo para validar a credencial
                ao vivo (não gasta o saldo do portal ONR).
              </p>
            </>
          ) : (
            <>
              <p className="text-amber-900">
                {onr.error ??
                  "Credenciais ONR/ARISP não configuradas (INFOSIMPLES_ONR_*)."}
              </p>
              <p className="text-xs text-muted-foreground">
                Sem credencial, matrícula e pesquisa de bens no ONR ficam puladas.
                Configure login/senha ou certificado A1 do portal de Registradores.
              </p>
              <a
                href="https://www.registradores.org.br/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline mt-1"
              >
                Abrir portal ONR/Registradores <ExternalLink className="h-3 w-3" />
              </a>
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Wallet className="h-4 w-4" /> Infosimples — mês
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{brl(monthSpend)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {monthJobsInfosimples.length} consulta{monthJobsInfosimples.length === 1 ? "" : "s"} no mês
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Wallet className="h-4 w-4 text-amber-700" /> Serasa — mês
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{brl(monthSpendSerasa)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {monthJobsSerasa.length} consulta{monthJobsSerasa.length === 1 ? "" : "s"} no mês
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" /> Taxa de sucesso
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{successRate}%</p>
            <p className="text-xs text-muted-foreground mt-1">
              {successCount}/{totalLast30} nos últimos 30 dias
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <XCircle className="h-4 w-4 text-red-600" /> Falhas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{failedCount}</p>
            <p className="text-xs text-muted-foreground mt-1">nos últimos 30 dias</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-600" /> Aguardando portal
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{awaitingCount}</p>
            <p className="text-xs text-muted-foreground mt-1">
              pedidos TJSP/TJRJ pendentes
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Por endpoint (últimos 30 dias)</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs">
                <tr>
                  <th className="text-left p-2">Endpoint</th>
                  <th className="text-right p-2">Total</th>
                  <th className="text-right p-2">Sucesso</th>
                  <th className="text-right p-2">Falhas</th>
                  <th className="text-right p-2">Taxa</th>
                  <th className="text-right p-2">Latência p50</th>
                  <th className="text-right p-2">Latência p95</th>
                </tr>
              </thead>
              <tbody>
                {endpointRows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-muted-foreground">
                      Nenhuma extração nos últimos 30 dias.
                    </td>
                  </tr>
                )}
                {endpointRows.map((row) => (
                  <tr key={row.endpoint} className="border-t">
                    <td className="p-2 font-medium">{row.label}</td>
                    <td className="text-right p-2 tabular-nums">{row.total}</td>
                    <td className="text-right p-2 tabular-nums text-green-700">
                      {row.success}
                    </td>
                    <td className="text-right p-2 tabular-nums text-red-700">
                      {row.failed}
                    </td>
                    <td className="text-right p-2 tabular-nums">
                      <Badge
                        variant="outline"
                        className={
                          row.successRate >= 95
                            ? "border-green-500 text-green-700"
                            : row.successRate >= 80
                            ? "border-amber-500 text-amber-700"
                            : "border-red-500 text-red-700"
                        }
                      >
                        {row.successRate}%
                      </Badge>
                    </td>
                    <td className="text-right p-2 tabular-nums">
                      {row.p50ms > 0 ? `${Math.round(row.p50ms / 1000)}s` : "—"}
                    </td>
                    <td className="text-right p-2 tabular-nums">
                      {row.p95ms > 0 ? `${Math.round(row.p95ms / 1000)}s` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {creditExhausted && (
        <Card className="border-red-300 bg-red-50/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-red-800">
              <AlertTriangle className="h-4 w-4 text-red-600" />
              Crédito Infosimples esgotado
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            <p className="text-red-900">
              Detectamos respostas <span className="font-mono">603/604</span> ("limite de uso") nas últimas 24h —
              o crédito da conta provavelmente acabou. As consultas pagas ficam <strong>pausadas</strong> (circuit
              breaker) até a recarga, para não desperdiçar tentativas.
            </p>
            <a
              href="https://portal.infosimples.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline mt-1"
            >
              Recarregar crédito no portal Infosimples <ExternalLink className="h-3 w-3" />
            </a>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            Monitoramento & Problemas
            {pausedSpike > 0 && (
              <Badge variant="outline" className="border-amber-500 text-amber-700">
                {pausedSpike} resposta(s) "API pausada" (24h)
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <CertidoesMonitorClient problems={problems} />
        </CardContent>
      </Card>

      {recentErrors.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-600" />
              Erros recentes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {recentErrors.map((err) => (
                <li key={err.id} className="text-xs border rounded p-2">
                  <div className="flex justify-between gap-2 mb-1">
                    {/* Job sem deal (ad-hoc / cliente de locação) entra na lista
                        desde que a contagem passou a incluir jobs por orgId. */}
                    {err.dealId ? (
                      <Link
                        href={`/deals/${err.dealId}`}
                        className="font-medium truncate hover:underline"
                      >
                        {err.label}
                      </Link>
                    ) : (
                      <span className="font-medium truncate">{err.label}</span>
                    )}
                    <span className="text-muted-foreground shrink-0">
                      {new Date(err.createdAt).toLocaleString("pt-BR")}
                    </span>
                  </div>
                  <div className="text-muted-foreground font-mono text-[11px]">
                    {err.errorMessage}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
