import { redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { getGoogleConnectionForOrg } from "@/lib/google/connection";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Integração Google — Contractmaker" };

/**
 * Fase 1b — conectar o Google da org (OAuth). Aditivo: sem conexão, os contratos
 * usam o Service Account global da plataforma (fallback). Com conexão ACTIVE,
 * passam a usar o Drive/Docs do tenant.
 */
export default async function GoogleIntegrationPage({
  searchParams,
}: {
  searchParams: { connected?: string; error?: string };
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/");

  const conn = await getGoogleConnectionForOrg(org.id);
  const connected = conn?.status === "ACTIVE" && !!conn.refreshTokenCiphertext;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="font-display text-2xl font-semibold">Integração Google</h1>
        <p className="text-sm text-muted-foreground">
          Conecte o Google da imobiliária para que os contratos vivam no Drive do
          próprio tenant. Sem conexão, usamos o Drive da plataforma (fallback).
        </p>
      </header>

      {searchParams.connected && (
        <div className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-800">
          ✓ Google conectado com sucesso.
        </div>
      )}
      {searchParams.error && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          Falha ao conectar: {searchParams.error}
        </div>
      )}

      <div className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <span
            className={`inline-block h-2.5 w-2.5 rounded-full ${connected ? "bg-green-500" : "bg-muted-foreground/40"}`}
          />
          <span className="text-sm font-medium">
            {connected ? "Conectado" : "Não conectado (usando fallback da plataforma)"}
          </span>
        </div>
        {connected && conn?.driveRootFolderId && (
          <p className="mb-3 text-xs text-muted-foreground">
            Pasta raiz: <code>{conn.driveRootFolderId}</code>
            {conn.adminUserEmail ? ` · ${conn.adminUserEmail}` : ""}
          </p>
        )}
        <Button asChild>
          <a href="/api/integrations/google/start">
            {connected ? "Reconectar Google" : "Conectar Google"}
          </a>
        </Button>
      </div>
    </div>
  );
}
