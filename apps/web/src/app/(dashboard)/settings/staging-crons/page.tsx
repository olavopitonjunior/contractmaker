import { notFound, redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StagingCronsClient } from "@/components/settings/StagingCronsClient";

export const dynamic = "force-dynamic";

// Lista canônica dos crons + label + flag "real-money" pra UI alertar.
export const CRON_CATALOG = [
  { path: "/api/cron/ocr-queue", label: "OCR queue", schedule: "*/1 * * * *", realMoney: false },
  { path: "/api/cron/intents/expire", label: "Action intents expire", schedule: "*/10 * * * *", realMoney: false },
  { path: "/api/cron/drafts/cleanup", label: "Drafts cleanup", schedule: "0 3 * * *", realMoney: false },
  { path: "/api/cron/agent-runs/cleanup", label: "AgentRun cleanup", schedule: "0 4 * * *", realMoney: false },
  { path: "/api/cron/api-usage/cleanup", label: "AIUsage cleanup", schedule: "0 4 * * *", realMoney: false },
  { path: "/api/cron/webhooks/retry-orphaned", label: "Webhooks retry", schedule: "0 3 * * *", realMoney: false },
  { path: "/api/cron/google-watches/renew", label: "Google Drive watches renew", schedule: "0 */6 * * *", realMoney: false },
  { path: "/api/cron/charges/due-soon", label: "Cobranças D-3 notify", schedule: "0 12 * * *", realMoney: true },
  { path: "/api/cron/clicksign/sync-envelopes", label: "ClickSign sync (fallback)", schedule: "0 6 * * *", realMoney: false },
  { path: "/api/cron/newton-requests/sweep", label: "Newton sweep", schedule: "0 * * * *", realMoney: true },
  { path: "/api/cron/newton-requests/group-match", label: "Newton group-match", schedule: "30 * * * *", realMoney: false },
  { path: "/api/cron/certidoes/poll-portal", label: "Certidões poll portal", schedule: "*/5 * * * *", realMoney: true },
  { path: "/api/cron/certidoes/problem-digest", label: "Certidões digest email", schedule: "0 13 * * *", realMoney: true },
  { path: "/api/cron/asaas/transfer-dispatch", label: "Asaas transfer dispatch", schedule: "*/10 * * * *", realMoney: true },
  { path: "/api/cron/locacao/newton/check-late-payments", label: "Newton: late payments", schedule: "0 8 * * *", realMoney: true },
  { path: "/api/cron/locacao/newton/check-readjustments", label: "Newton: readjustments", schedule: "0 9 * * *", realMoney: true },
  { path: "/api/cron/rent/generate", label: "Rent charges materialize", schedule: "0 0 1 * *", realMoney: true },
  { path: "/api/cron/rent/readjust", label: "Rent readjustments propose", schedule: "0 1 1 * *", realMoney: true },
] as const;

export default async function StagingCronsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const org = await getUserOrg(session.user.id);
  if (!org) notFound();

  const membership = await prisma.orgMembership.findFirst({
    where: { orgId: org.id, userId: session.user.id },
    select: { role: true },
  });
  const isOwner = membership?.role === "owner";
  const stagingMode = process.env.STAGING_MODE === "true";

  const toggles = await prisma.cronToggle.findMany();
  const toggleMap = new Map(toggles.map((t) => [t.path, t.enabled]));

  const items = CRON_CATALOG.map((c) => ({
    path: c.path,
    label: c.label,
    schedule: c.schedule,
    realMoney: c.realMoney,
    enabled: toggleMap.get(c.path) ?? false,
  }));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Cron jobs — gating staging</h1>
        <p className="text-sm text-muted-foreground">
          Em staging cada cron precisa estar ligado aqui pra rodar. Em prod a tabela é
          ignorada e todos os crons rodam sempre.
        </p>
      </div>

      {!stagingMode && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100">
          <strong>Você está em produção.</strong> Mudanças nessa tela não têm efeito —
          crons sempre rodam quando <code>STAGING_MODE=true</code> está ausente.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{items.length} crons registrados</CardTitle>
        </CardHeader>
        <CardContent>
          {isOwner ? (
            <StagingCronsClient items={items} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Apenas owners da organização podem ligar/desligar crons.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
