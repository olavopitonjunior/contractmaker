import { notFound } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { DefaultWitnessesClient } from "@/components/settings/DefaultWitnessesClient";

export const dynamic = "force-dynamic";

export default async function DefaultWitnessesSettingsPage() {
  const session = await auth();
  if (!session?.user) notFound();

  const org = await getUserOrg(session.user.id);
  if (!org) notFound();

  return <DefaultWitnessesClient />;
}
