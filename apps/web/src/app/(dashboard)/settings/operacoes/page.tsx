import { notFound } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { OperacoesClient } from "@/components/settings/OperacoesClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Operações — Contractmaker" };

export default async function OperacoesPage() {
  const session = await auth();
  if (!session?.user) notFound();

  const org = await getUserOrg(session.user.id);
  if (!org) notFound();

  return <OperacoesClient />;
}
