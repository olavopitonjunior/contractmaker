import { notFound } from "next/navigation";
import Link from "next/link";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRight, ShieldAlert, Clock } from "lucide-react";

export const dynamic = "force-dynamic";

const STATUS_VARIANT: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  pending: { label: "Pendente", variant: "default" },
  approved: { label: "Aprovada", variant: "secondary" },
  executed: { label: "Executada", variant: "secondary" },
  rejected: { label: "Rejeitada", variant: "destructive" },
  expired: { label: "Expirada", variant: "outline" },
  failed: { label: "Falhou", variant: "destructive" },
};

const ACTION_LABELS: Record<string, string> = {
  CHARGE_CREATE: "Criar cobrança Asaas",
  ENVELOPE_SEND: "Enviar envelope ClickSign",
  CONTRACT_APPROVE: "Aprovar contrato",
  DEAL_DELETE_HARD: "Excluir deal (permanente)",
};

export default async function IntentsPage() {
  const session = await auth();
  if (!session?.user?.id) notFound();
  const org = await getUserOrg(session.user.id);
  if (!org) notFound();

  const intents = await prisma.actionIntent.findMany({
    where: { orgId: org.id },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 100,
    include: {
      requester: { select: { id: true, name: true, email: true } },
      token: { select: { id: true, name: true } },
    },
  });

  const pending = intents.filter((i) => i.status === "pending");
  const others = intents.filter((i) => i.status !== "pending");

  return (
    <div className="space-y-6">
      <h1 className="font-display tracking-tight text-2xl font-semibold flex items-center gap-2">
        <ShieldAlert className="h-6 w-6" />
        Intents (aprovação de ações via API)
      </h1>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-amber-500" />
            Pendentes ({pending.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {pending.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Nenhuma intent aguardando aprovação.
            </p>
          ) : (
            <div className="space-y-3">
              {pending.map((i) => {
                const preview = i.preview as {
                  summary?: string;
                  details?: Record<string, unknown>;
                };
                return (
                  <div
                    key={i.id}
                    className="border rounded-md p-4 hover:bg-muted/30 transition"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className="font-mono text-[10px]">
                            {i.action}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            por{" "}
                            {i.requester.name ?? i.requester.email ?? "—"}
                            {i.token && ` (token: ${i.token.name})`}
                          </span>
                        </div>
                        <p className="text-sm font-medium">
                          {preview.summary ?? ACTION_LABELS[i.action] ?? i.action}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Expira em{" "}
                          {new Date(i.expiresAt).toLocaleString("pt-BR")}
                        </p>
                      </div>
                      <Button variant="default" size="sm" asChild>
                        <Link href={`/intents/${i.id}`}>
                          Revisar
                          <ArrowRight className="h-4 w-4 ml-1" />
                        </Link>
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Histórico ({others.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {others.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Nenhuma intent processada ainda.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Ação</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                    <th className="py-2 pr-4 font-medium">Solicitante</th>
                    <th className="py-2 pr-4 font-medium">Criada</th>
                    <th className="py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {others.map((i) => {
                    const status = STATUS_VARIANT[i.status] ?? {
                      label: i.status,
                      variant: "outline" as const,
                    };
                    return (
                      <tr key={i.id} className="border-b last:border-0">
                        <td className="py-2 pr-4 font-mono text-[11px]">
                          {i.action}
                        </td>
                        <td className="py-2 pr-4">
                          <Badge variant={status.variant}>{status.label}</Badge>
                        </td>
                        <td className="py-2 pr-4 text-muted-foreground">
                          {i.requester.name ?? i.requester.email ?? "—"}
                        </td>
                        <td className="py-2 pr-4 text-muted-foreground">
                          {new Date(i.createdAt).toLocaleDateString("pt-BR")}
                        </td>
                        <td className="py-2">
                          <Button variant="ghost" size="sm" asChild>
                            <Link href={`/intents/${i.id}`}>Ver</Link>
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
