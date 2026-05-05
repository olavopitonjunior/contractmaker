import { notFound } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { ApiUsageClient } from "@/components/settings/ApiUsageClient";

export const dynamic = "force-dynamic";

export default async function ApiUsagePage() {
  const session = await auth();
  if (!session?.user) notFound();
  const org = await getUserOrg(session.user.id);
  if (!org) notFound();

  return <ApiUsageClient />;
}
