import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { FormSettingsClient } from "./FormSettingsClient";

export default async function FormularioSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const org = await getUserOrg(session.user.id);
  if (!org) redirect("/login");

  // Lazy create (idêntico ao branding). Mantém row "legado" pra orgs antigas.
  let settings = await prisma.orgFormSettings.findUnique({
    where: { orgId: org.id },
  });
  if (!settings) {
    settings = await prisma.orgFormSettings.create({
      data: { orgId: org.id },
    });
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Button variant="ghost" size="sm" asChild className="mb-2 -ml-2">
          <Link href="/settings">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Voltar para Configurações
          </Link>
        </Button>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Formulário público</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Defina quais campos do formulário <code>/f/[token]</code> são
          obrigatórios. Pequenos negócios podem usar Mínimo; cartórios e
          certidões TJSP/PGFN exigem Completo.
        </p>
      </div>

      <FormSettingsClient
        initial={{
          preset: settings.preset,
          customRequiredPaths: settings.customRequiredPaths as unknown,
        }}
      />
    </div>
  );
}
