"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, FileSignature } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ClickSignConnectCard } from "@/components/settings/ClickSignConnectCard";
import { SignaturePreferencesForm } from "@/components/settings/SignaturePreferencesForm";
import { DefaultWitnessesClient } from "@/components/settings/DefaultWitnessesClient";
import { SignaturesClient } from "@/components/settings/SignaturesClient";

const TABS = ["conexao", "preferencias", "testemunhas", "metricas"] as const;
type TabKey = (typeof TABS)[number];

/**
 * Área unificada de Assinaturas: conexão da conta ClickSign, preferências
 * (tipos/orçamento/padrões), testemunhas padrão e métricas — antes espalhadas
 * em /settings/signatures + /settings/testemunhas.
 */
export function SignaturesHubClient({ initialTab }: { initialTab?: string }) {
  const start = (TABS as readonly string[]).includes(initialTab ?? "")
    ? (initialTab as TabKey)
    : "conexao";
  const [tab, setTab] = useState<TabKey>(start);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <div>
        <Link
          href="/settings"
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Configurações
        </Link>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <FileSignature className="h-5 w-5" /> Assinaturas
        </h1>
        <p className="text-sm text-muted-foreground">
          Conecte sua conta ClickSign, defina os tipos de assinatura e as
          testemunhas padrão da imobiliária.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="conexao">Conexão</TabsTrigger>
          <TabsTrigger value="preferencias">Preferências</TabsTrigger>
          <TabsTrigger value="testemunhas">Testemunhas</TabsTrigger>
          <TabsTrigger value="metricas">Métricas</TabsTrigger>
        </TabsList>

        <TabsContent value="conexao" className="mt-4">
          <ClickSignConnectCard />
        </TabsContent>
        <TabsContent value="preferencias" className="mt-4">
          <SignaturePreferencesForm />
        </TabsContent>
        <TabsContent value="testemunhas" className="mt-4">
          <DefaultWitnessesClient embedded />
        </TabsContent>
        <TabsContent value="metricas" className="mt-4">
          <SignaturesClient embedded />
        </TabsContent>
      </Tabs>
    </div>
  );
}
