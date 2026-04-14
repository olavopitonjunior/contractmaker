import { redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { DocumentStylesClient } from "@/components/settings/DocumentStylesClient";

export default async function DocumentStylesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/settings");

  const styles = await prisma.documentStyle.findMany({
    where: { orgId: org.id },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });

  return (
    <DocumentStylesClient
      initialStyles={styles.map((s) => ({
        ...s,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      }))}
    />
  );
}
