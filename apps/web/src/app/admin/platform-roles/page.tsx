import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth/auth";
import { getPlatformRole } from "@/lib/security/rbac/platform";
import { PlatformRolesClient } from "./PlatformRolesClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Staff de plataforma — Admin" };

/** Gestão de PlatformRole (staff de plataforma). Apenas super_admin. */
export default async function PlatformRolesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const role = await getPlatformRole(session.user.id);
  if (!role) redirect("/");
  if (role.role !== "super_admin") redirect("/admin/orgs");

  return (
    <div className="mx-auto max-w-3xl p-6">
      <header className="mb-6">
        <Link href="/admin/orgs" className="text-xs text-muted-foreground hover:underline">
          ← Organizações
        </Link>
        <h1 className="font-display text-2xl font-semibold">Staff de plataforma</h1>
        <p className="text-sm text-muted-foreground">
          Quem tem acesso ao painel super-admin (super_admin · support · billing).
        </p>
      </header>
      <PlatformRolesClient currentUserId={session.user.id} />
    </div>
  );
}
