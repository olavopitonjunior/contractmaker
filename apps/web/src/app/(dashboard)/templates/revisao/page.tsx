import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { isOrgOwnerAdmin } from "@/lib/auth/org-role";
import { LibraryReviewClient } from "@/components/templates/LibraryReviewClient";

export const metadata = {
  title: "Revisão da biblioteca",
};

/**
 * Revisão de TODA a biblioteca — modelos e cláusulas — numa tela só.
 *
 * O gate de owner/admin é o mesmo da rota que a tela chama: sem ele, um membro
 * comum abriria uma página que só sabe mostrar erros de permissão.
 */
export default async function LibraryReviewPage() {
  const session = await auth();
  if (!session?.user) return null;
  const org = await getUserOrg(session.user.id);
  if (!org) return null;

  if (!(await isOrgOwnerAdmin(session.user.id, org.id))) notFound();

  return (
    <div className="space-y-4">
      <Link
        href="/templates"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Voltar aos modelos
      </Link>
      <LibraryReviewClient />
    </div>
  );
}
