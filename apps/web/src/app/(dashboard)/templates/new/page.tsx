import { auth } from "@/lib/auth/auth";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TemplateEditor } from "@/components/templates/TemplateEditor";

export default async function NewTemplatePage() {
  const session = await auth();
  if (!session?.user) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/templates">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Templates
          </Link>
        </Button>
        <h1 className="font-display tracking-tight text-2xl font-semibold">
          Criar template do zero
        </h1>
      </div>

      <p className="text-sm text-muted-foreground">
        Editor Handlebars (avançado) — loops, conditionals e cláusulas variáveis. Para usar o
        modelo timbrado da sua imobiliária, prefira{" "}
        <Link href="/templates" className="underline">
          Importar modelo (.docx)
        </Link>
        .
      </p>

      <TemplateEditor mode="create" />
    </div>
  );
}
