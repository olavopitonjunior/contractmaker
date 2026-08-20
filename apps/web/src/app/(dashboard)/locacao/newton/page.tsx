import { prisma } from "@/lib/db/prisma";
import { requireFeaturePage } from "@/lib/modules/page-guard";
import { FEATURE } from "@/lib/modules/catalog";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Bell, MessageSquare } from "lucide-react";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  open: "default",
  chasing: "secondary",
  awaiting_reply: "secondary",
  fulfilled: "outline",
  cancelled: "outline",
};

interface TimelineEvent {
  at: string;
  actor: string;
  type: string;
  note?: string;
}

export default async function LocacaoNewtonInboxPage({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string }>;
}) {
  // Tenant sem o Newton (default do catálogo) não tem inbox — redireciona.
  const { orgId } = await requireFeaturePage(FEATURE.LOCACAO_NEWTON);

  const params = (await searchParams) ?? {};
  const status = params.status;

  const requests = await prisma.newtonRequest.findMany({
    where: {
      orgId,
      ...(status
        ? { status }
        : { status: { in: ["open", "chasing", "awaiting_reply"] } }),
    },
    orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
    take: 100,
  });

  const counts = await prisma.newtonRequest.groupBy({
    by: ["status"],
    where: { orgId },
    _count: { _all: true },
  });
  const countMap = Object.fromEntries(counts.map((c) => [c.status, c._count._all]));

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">Newton — Inbox</h2>
        <p className="text-sm text-muted-foreground">
          Pedidos abertos para Newton operar no WhatsApp. Régua de cobrança, docs pendentes,
          agendamentos.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["open", "chasing", "awaiting_reply", "fulfilled", "cancelled"] as const).map((s) => (
          <Badge key={s} variant={status === s ? "default" : "outline"}>
            {s} ({countMap[s] ?? 0})
          </Badge>
        ))}
      </div>

      {requests.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Bell className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">
              Nenhum pedido. Newton recebe pedidos via{" "}
              <code className="text-xs">POST /api/newton/requests</code> ou dunningExecutor.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {requests.map((r) => {
            const events = Array.isArray(r.eventsJson)
              ? (r.eventsJson as unknown as TimelineEvent[])
              : [];
            const lastEvent = events[events.length - 1];
            return (
              <Card key={r.id} className={r.priority === "high" ? "border-destructive/40" : ""}>
                <CardContent className="space-y-2 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="font-medium text-sm">{r.ask}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        <MessageSquare className="mr-1 inline h-3 w-3" />
                        {r.targetType === "contact" ? "Contato" : "Grupo"} ·{" "}
                        {r.targetLabel ?? r.targetRef ?? "—"} · criado{" "}
                        {r.createdAt.toLocaleDateString("pt-BR")}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge variant={STATUS_TONE[r.status] ?? "outline"}>{r.status}</Badge>
                      {r.priority === "high" && (
                        <Badge variant="destructive" className="text-[10px]">
                          alta
                        </Badge>
                      )}
                    </div>
                  </div>
                  {lastEvent && (
                    <div className="rounded-md bg-muted/40 px-3 py-2 text-xs">
                      <div className="font-medium">
                        {lastEvent.actor} · {lastEvent.type}
                      </div>
                      {lastEvent.note && (
                        <div className="mt-0.5 text-muted-foreground">{lastEvent.note}</div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
