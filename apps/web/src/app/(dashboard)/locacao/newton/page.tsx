import { redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function LocacaoNewtonInboxPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/");

  const requests = await prisma.newtonRequest.findMany({
    where: { orgId: org.id, status: { in: ["open", "chasing", "awaiting_reply"] } },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Newton — pedidos abertos ({requests.length})</CardTitle>
      </CardHeader>
      <CardContent>
        {requests.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum pedido aberto.</p>
        ) : (
          <ul className="divide-y">
            {requests.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <div className="font-medium">{r.ask}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.targetLabel ?? r.targetRef} · {r.priority}
                  </div>
                </div>
                <Badge variant="outline">{r.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
