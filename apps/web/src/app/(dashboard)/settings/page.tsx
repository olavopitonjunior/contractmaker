import Link from "next/link";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { AgentSettings } from "@/components/settings/AgentSettings";
import { BookOpen } from "lucide-react";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) return null;

  const org = await getUserOrg(session.user.id);

  const agentConfig = org
    ? await prisma.agentConfig.findUnique({ where: { orgId: org.id } })
    : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-semibold">Configurações</h1>
        <Button variant="outline" size="sm" asChild>
          <Link href="/settings/knowledge-base">
            <BookOpen className="h-4 w-4 mr-1" />
            Base de Conhecimento
          </Link>
        </Button>
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
            <CardContent className="space-y-2">
              <p className="text-sm">
                <span className="text-muted-foreground">Nome:</span>{" "}
                {session.user.name || "—"}
              </p>
              <p className="text-sm">
                <span className="text-muted-foreground">Email:</span>{" "}
                {session.user.email}
              </p>
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
