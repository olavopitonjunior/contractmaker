import { notFound } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { SignaturesHubClient } from "@/components/settings/SignaturesHubClient";

export const dynamic = "force-dynamic";

export default async function SignaturesSettingsPage({
  searchParams,
}: {
  searchParams: { tab?: string };
}) {
  const session = await auth();
  if (!session?.user) notFound();

  const org = await getUserOrg(session.user.id);
  if (!org) notFound();

  return <SignaturesHubClient initialTab={searchParams?.tab} />;
}
