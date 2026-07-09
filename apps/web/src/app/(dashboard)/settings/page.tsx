import Link from "next/link";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { AgentSettings } from "@/components/settings/AgentSettings";
import { BookOpen, Palette, Lightbulb, ShieldCheck, Sparkles, KeyRound, Users, UsersRound, Split, FileSignature, Wallet, ListChecks, UserRound, Receipt, FileText, Rocket, type LucideIcon } from "lucide-react";

type SettingsLink = { href: string; label: string; icon: LucideIcon };
const SETTINGS_GROUPS: { title: string; items: SettingsLink[] }[] = [
  {
    title: "Conta & organização",
    items: [
      { href: "/onboarding", label: "Primeiros passos", icon: Rocket },
      { href: "/settings/profile", label: "Meu perfil", icon: UserRound },
      { href: "/settings/membros", label: "Membros", icon: Users },
      { href: "/settings/seguranca", label: "Segurança", icon: KeyRound },
    ],
  },
  {
    title: "Conteúdo & documentos",
    items: [
      { href: "/settings/knowledge-base", label: "Base de conhecimento", icon: BookOpen },
      { href: "/settings/document-styles", label: "Estilos de documento", icon: Palette },
      { href: "/settings/formulario", label: "Formulário", icon: ListChecks },
      { href: "/clauses/proposals", label: "Propostas de cláusulas", icon: Lightbulb },
    ],
  },
  {
    title: "Financeiro & assinaturas",
    items: [
      { href: "/settings/pagamentos/contas", label: "Contas bancárias", icon: Wallet },
      { href: "/settings/pagamentos/split-recipients", label: "Destinatários de split", icon: Split },
      { href: "/settings/signatures", label: "Assinaturas", icon: FileSignature },
      { href: "/settings/testemunhas", label: "Testemunhas padrão", icon: UsersRound },
    ],
  },
  {
    title: "Certidões, IA & API",
    items: [
      { href: "/settings/certidoes", label: "Certidões", icon: ShieldCheck },
      { href: "/settings/ai-usage", label: "Uso de IA", icon: Sparkles },
      { href: "/settings/api-tokens", label: "API tokens", icon: KeyRound },
      { href: "/settings/api-usage", label: "Uso da API", icon: Sparkles },
    ],
  },
  {
    title: "Fiscal & DIMOB",
    items: [
      { href: "/settings/fiscal", label: "Dados fiscais (declarante)", icon: FileText },
      { href: "/relatorios/dimob", label: "Gerar DIMOB", icon: Receipt },
    ],
  },
  {
    title: "Integrações",
    items: [
      { href: "/settings/integracoes", label: "Google Drive da imobiliária", icon: KeyRound },
    ],
  },
];

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) return null;

  const org = await getUserOrg(session.user.id);

  const agentConfig = org
    ? await prisma.agentConfig.findUnique({ where: { orgId: org.id } })
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Configurações"
        description="Conta, conteúdo, financeiro, certidões e integrações da sua organização."
      />

      {/* Atalhos agrupados por categoria — grid de cards navegáveis */}
      <div className="space-y-5">
        {SETTINGS_GROUPS.map((group) => (
          <div key={group.title} className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {group.title}
            </h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center gap-3 rounded-lg border bg-card p-3 text-sm transition-colors hover:border-primary/40 hover:bg-accent"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <item.icon className="h-4 w-4" />
                  </span>
                  <span className="font-medium">{item.label}</span>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>

      <Tabs defaultValue="perfil">
        <TabsList>
          <TabsTrigger value="perfil">Perfil</TabsTrigger>
          {org && <TabsTrigger value="organizacao">Organização</TabsTrigger>}
          <TabsTrigger value="agente">Agente IA</TabsTrigger>
        </TabsList>

        <TabsContent value="perfil" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Perfil</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm">
                <span className="text-muted-foreground">Nome:</span>{" "}
                {session.user.name || "—"}
              </p>
              <p className="text-sm">
                <span className="text-muted-foreground">Email:</span>{" "}
                {session.user.email}
              </p>
              <Button variant="outline" size="sm" asChild>
                <Link href="/settings/profile">
                  <UserRound className="h-4 w-4 mr-1" />
                  Editar perfil completo (CPF, telefone, endereço, senha)
                </Link>
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {org && (
          <TabsContent value="organizacao" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Organização</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-sm">
                  <span className="text-muted-foreground">Nome:</span>{" "}
                  {org.name}
                </p>
                <p className="text-sm">
                  <span className="text-muted-foreground">Slug:</span>{" "}
                  {org.slug}
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        <TabsContent value="agente" className="mt-4">
          <AgentSettings
            initialConfig={
              agentConfig
                ? {
                    model: agentConfig.model,
                    ocrModel: agentConfig.ocrModel,
                    temperature: agentConfig.temperature,
                    maxTokens: agentConfig.maxTokens,
                    systemPrompt: agentConfig.systemPrompt,
                  }
                : null
            }
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
