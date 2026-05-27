import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { can, getEffectivePermissions } from "@/lib/security/rbac/check";
import { PERMISSION } from "@/lib/security/rbac/permissions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Atividade do usuário — Contractmaker" };

/**
 * Fase 1f — visão consolidada da atividade de UM usuário dentro do tenant.
 * Sumário 30d + timeline recente. Gated por AUDIT_VIEW + membership do alvo na org.
 */
export default async function UserAuditPage({
  params,
}: {
  params: { userId: string };
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/");

  const perms = await getEffectivePermissions(session.user.id, org.id);
  if (!perms || !can(perms, PERMISSION.AUDIT_VIEW)) {
    redirect("/settings/seguranca/audit-log");
  }

  // O alvo precisa ser membro desta org (evita vazar atividade cross-org).
  const target = await prisma.user.findFirst({
    where: { id: params.userId, orgMemberships: { some: { orgId: org.id } } },
    select: { id: true, name: true, email: true },
  });
  if (!target) notFound();

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [byResult, recent] = await Promise.all([
    prisma.auditLog.groupBy({
      by: ["result"],
      where: { orgId: org.id, userId: target.id, createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.auditLog.findMany({
      where: { orgId: org.id, userId: target.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, action: true, result: true, resource: true, resourceType: true, createdAt: true },
    }),
  ]);

  const counts = Object.fromEntries(byResult.map((r) => [r.result, r._count._all]));
  const total30d = byResult.reduce((s, r) => s + r._count._all, 0);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/settings/seguranca/audit-log" className="text-sm text-muted-foreground hover:underline">
          ← Registro de atividade
        </Link>
        <h1 className="font-display text-2xl font-semibold mt-1">
          {target.name ?? target.email}
        </h1>
        <p className="text-sm text-muted-foreground">{target.email}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Ações (30d)" value={total30d} />
        <Stat label="Sucesso" value={counts.SUCCESS ?? 0} />
        <Stat label="Falha" value={counts.FAILURE ?? 0} />
        <Stat label="Negado" value={counts.DENIED ?? 0} />
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Data</th>
              <th className="px-3 py-2">Ação</th>
              <th className="px-3 py-2">Resultado</th>
              <th className="px-3 py-2">Recurso</th>
            </tr>
          </thead>
          <tbody>
            {recent.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">
                  Nenhuma atividade registrada
                </td>
              </tr>
            )}
            {recent.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="px-3 py-2 whitespace-nowrap">
                  {r.createdAt.toLocaleString("pt-BR")}
                </td>
                <td className="px-3 py-2 font-mono text-xs">{r.action}</td>
                <td className="px-3 py-2">{r.result}</td>
                <td className="px-3 py-2 text-muted-foreground text-xs">
                  {r.resourceType ? `${r.resourceType}:` : ""}
                  {r.resource ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
