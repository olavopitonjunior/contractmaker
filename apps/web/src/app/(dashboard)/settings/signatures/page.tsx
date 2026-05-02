import { notFound } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { SignaturesClient } from "@/components/settings/SignaturesClient";

export const dynamic = "force-dynamic";

export default async function SignaturesSettingsPage() {
  const session = await auth();
  if (!session?.user) notFound();

  const org = await getUserOrg(session.user.id);
  if (!org) notFound();

  return <SignaturesClient />;
}
