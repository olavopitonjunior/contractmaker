import { notFound } from "next/navigation";
import { auth } from "@/lib/auth/auth";
import { listApiTokens } from "@/lib/auth/api-token";
import { ApiTokensClient } from "@/components/settings/ApiTokensClient";

export const dynamic = "force-dynamic";

export default async function ApiTokensPage() {
  const session = await auth();
  if (!session?.user?.id) notFound();

  const tokens = await listApiTokens(session.user.id);

  return (
    <ApiTokensClient
      initialTokens={tokens.map((t) => ({
        id: t.id,
        name: t.name,
        scopes: t.scopes,
        lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
        expiresAt: t.expiresAt?.toISOString() ?? null,
        revokedAt: t.revokedAt?.toISOString() ?? null,
        createdAt: t.createdAt.toISOString(),
      }))}
    />
  );
}
