import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth";
import { getPlatformRole } from "@/lib/security/rbac/platform";
import { AdminNav } from "./AdminNav";

/**
 * Shell do painel super-admin. Até aqui cada página de /admin/* desenhava o
 * próprio header e só /admin/orgs tinha nav — as demais nem linkavam de volta
 * (a de knowledge chegou a ficar órfã, alcançável só digitando a URL).
 *
 * O gate roda aqui uma vez: sem sessão → /login; sem PlatformRole → raiz.
 * As páginas mantêm as próprias checagens de escrita (`canEdit`,
 * super_admin-only etc.) — o layout decide quem ENTRA, cada página decide o
 * que quem entrou pode fazer.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const platformRole = await getPlatformRole(session.user.id);
  if (!platformRole) redirect("/");

  return (
    <div className="min-h-screen">
      <AdminNav isSuperAdmin={platformRole.role === "super_admin"} />
      {children}
    </div>
  );
}
