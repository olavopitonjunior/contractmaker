import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = { title: "Conta suspensa — imobpro" };

/**
 * Aviso de conta suspensa. Fora do layout (dashboard) para não cair no guard de
 * suspensão (que redireciona pra cá) e gerar loop. Acesso é restaurado quando o
 * super-admin reativa o tenant no painel /admin.
 */
export default function SuspensoPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-md space-y-4 rounded-xl border bg-card p-8 text-center shadow-sm">
        <h1 className="font-display text-2xl font-semibold">Conta suspensa</h1>
        <p className="text-sm text-muted-foreground">
          O acesso desta organização foi temporariamente suspenso pela
          administração da plataforma. Entre em contato com o suporte para mais
          informações.
        </p>
        <Link
          href="/logout"
          className="inline-flex h-9 items-center justify-center rounded-md border px-4 text-sm font-medium hover:bg-accent"
        >
          Sair
        </Link>
      </div>
    </main>
  );
}
