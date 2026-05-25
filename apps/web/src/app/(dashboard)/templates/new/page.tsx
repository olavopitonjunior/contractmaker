import { auth } from "@/lib/auth/auth";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TemplateEditor } from "@/components/templates/TemplateEditor";
import { ImportGoogleDocForm } from "@/components/templates/ImportGoogleDocForm";

export default async function NewTemplatePage({
  searchParams,
}: {
  searchParams?: { type?: string };
}) {
  const session = await auth();
  if (!session?.user) return null;

  const type = searchParams?.type === "google_docs" ? "google_docs" : null;

  if (!type) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/templates">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Templates
            </Link>
          </Button>
          <h1 className="font-display tracking-tight text-2xl font-semibold">Novo Template</h1>
        </div>

        <p className="text-sm text-muted-foreground">
          Escolha o tipo de template que deseja criar.
        </p>

        <div className="grid gap-4 md:grid-cols-2">
          <Link
            href="/templates/new?type=handlebars"
            className="rounded-md border p-5 hover:border-primary/40 transition-colors"
          >
            <h2 className="font-medium">Handlebars (recomendado)</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Template completo com loops, conditionals e cláusulas variáveis.
              Suporta múltiplos vendedores/compradores, branch PF/PJ, cônjuge,
              parcelas dinâmicas. Padrão pros CCVs.
            </p>
          </Link>

          <Link
            href="/templates/new?type=google_docs"
            className="rounded-md border p-5 hover:border-primary/40 transition-colors"
          >
            <h2 className="font-medium">Importar Google Doc existente</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Use um Google Doc que você já tem como template. Apenas{" "}
              <code className="rounded bg-muted px-1">{"{{tokens}}"}</code> são
              substituídos. Sem suporte a loops nem conditionals — bom pra
              contratos simples e aditivos.
            </p>
          </Link>
        </div>
      </div>
    );
  }

  if (type === "google_docs") {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/templates/new">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Voltar
            </Link>
          </Button>
          <h1 className="font-display tracking-tight text-2xl font-semibold">Importar Google Doc</h1>
        </div>
        <ImportGoogleDocForm />
      </div>
    );
  }

  return <TemplateEditor mode="create" />;
}
