import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { getEffectiveUserId } from "@/lib/auth/impersonation";
import { prisma } from "@/lib/db/prisma";
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

  const effUserId = await getEffectiveUserId(session.user.id);
  const membership = await prisma.orgMembership.findFirst({
    where: { userId: effUserId, orgId: org.id },
    select: { role: true },
  });
  if (!membership || !["owner", "admin"].includes(membership.role)) notFound();

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
