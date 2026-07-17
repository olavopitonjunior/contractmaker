import { redirect } from "next/navigation";

/**
 * Porta de entrada do painel super-admin (/admin). O gate por PlatformRole
 * roda no destino (/admin/orgs): não-staff é mandado pra raiz, sem sessão
 * vai pra /login.
 */
export default function AdminIndexPage() {
  redirect("/admin/orgs");
}
