import { notFound, redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StagingCronsClient } from "@/components/settings/StagingCronsClient";
import { CRON_CATALOG } from "./catalog";

export const dynamic = "force-dynamic";

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
