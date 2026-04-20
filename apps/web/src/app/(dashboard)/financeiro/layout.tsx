import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export default async function FinanceiroLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/");

  const account = await prisma.asaasAccount.findUnique({
    where: { orgId: org.id },
  });
  const approved = account?.status === "APPROVED";

  if (!approved) {
    const h = await headers();
    const pathname = h.get("x-pathname") ?? "";
    const isGatePath =
      pathname === "/financeiro" ||
      pathname.startsWith("/financeiro/onboarding");
    if (!isGatePath) {
      redirect("/financeiro");
    }
  }

  return <>{children}</>;
}
