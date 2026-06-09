"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ContractEditorPage } from "@/components/contracts/ContractEditorPage";
import { AddDocumentsCard } from "@/components/pipeline/AddDocumentsCard";
import { LeaseSignaturesTab } from "@/components/locacao/LeaseSignaturesTab";
import { Field } from "@/components/locacao/lease-detail/LeaseSection";
import { GARANTIA_TIPO_LABELS } from "@/lib/locacao/validators";
import { FileText, ExternalLink, ShieldCheck, ClipboardCheck, Umbrella, Receipt } from "lucide-react";
import { toast } from "sonner";

type ContractProp = React.ComponentProps<typeof ContractEditorPage>["contract"];
type VersionsProp = React.ComponentProps<typeof ContractEditorPage>["versions"];

interface LeaseProp {
  id: string;
  status: string;
  valorAluguel: number;
  taxaAdminPercent: number;
  diaVencimento: number;
  guarantee: { tipo: string; status: string; provider: string | null } | null;
  inspections: { id: string; tipo: string; status: string }[];
  insurancePolicies: { id: string; seguradora: string; status: string }[];
  rentCharges: { id: string; competencia: string; valorBase: number; status: string }[];
}

interface LocacaoDealDetailProps {
  deal: {
    id: string;
    title: string;
    stageName: string | null;
    formStatus: string | null;
    attachments: {
      id: string;
      filename: string;
      url: string;
      mime: string;
      category: string | null;
      createdAt: string;
    }[];
  };
  contract: ContractProp | null;
  versions: VersionsProp;
  lease: LeaseProp | null;
  /** Modo simplificado (LOCACAO_SIMPLIFIED_MODE): mostra só Contrato,
   *  Documentos e Assinaturas; esconde as abas de administração. */
  simplified?: boolean;
}

const BRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function LocacaoDealDetail({ deal, contract, versions, lease, simplified = false }: LocacaoDealDetailProps) {
  const router = useRouter();
  const [tab, setTab] = useState("contrato");
  const [activating, setActivating] = useState(false);

  const criarAdministracao = async () => {
    if (!lease) return;
    setActivating(true);
    try {
      const res = await fetch(`/api/locacao/leases/${lease.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "ativo" }),
      });
      if (res.ok) {
        toast.success("Administração criada — contrato ativo. As cobranças mensais serão geradas pelo agendador.");
        router.refresh();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Falha ao criar a administração.");
      }
    } catch {
      toast.error("Falha ao criar a administração.");
    } finally {
      setActivating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-semibold">{deal.title}</h2>
            {deal.stageName && <Badge variant="secondary">{deal.stageName}</Badge>}
            {lease && <Badge variant="outline">Locação · {lease.status}</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">Negócio de locação</p>
        </div>
        <Button variant="outline" asChild>
          <a href="/pipeline/locacao">Voltar ao pipeline</a>
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="contrato">Contrato</TabsTrigger>
          <TabsTrigger value="documentos">Documentos</TabsTrigger>
          <TabsTrigger value="assinaturas">Assinaturas</TabsTrigger>
          {!simplified && <TabsTrigger value="garantias">Garantias</TabsTrigger>}
          {!simplified && <TabsTrigger value="vistoria">Vistoria</TabsTrigger>}
          {!simplified && <TabsTrigger value="seguros">Seguros</TabsTrigger>}
          {!simplified && <TabsTrigger value="cobranca">Cobrança</TabsTrigger>}
        </TabsList>

        {/* CONTRATO — editor Google Docs + agente de IA (especializado em locação) */}
        <TabsContent value="contrato" className="mt-4">
          {contract ? (
            <ContractEditorPage contract={contract} versions={versions} />
          ) : (
            <Card>
              <CardContent className="py-10 text-center">
                <FileText className="mx-auto h-10 w-10 text-muted-foreground" />
                <p className="mt-3 text-sm font-medium">Contrato ainda não gerado</p>
                <p className="text-sm text-muted-foreground">
                  {deal.formStatus === "completo"
                    ? "A geração falhou — verifique se há um template de locação ativo (sync-templates --apply --seed)."
                    : "O contrato é gerado quando o cliente finaliza o formulário público."}
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* DOCUMENTOS — pasta do deal (DealAttachment), igual ao de vendas */}
        <TabsContent value="documentos" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Pasta de documentos ({deal.attachments.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {deal.attachments.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum documento ainda.</p>
              ) : (
                <ul className="divide-y">
                  {deal.attachments.map((a) => (
                    <li key={a.id} className="flex items-center justify-between py-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="truncate text-sm">{a.filename}</span>
                        {a.category && (
                          <Badge variant="outline" className="shrink-0 text-[10px]">
                            {a.category}
                          </Badge>
                        )}
                      </div>
                      <a
                        href={a.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-primary hover:underline shrink-0"
                      >
                        Abrir
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <AddDocumentsCard dealId={deal.id} onUploaded={() => router.refresh()} />
        </TabsContent>

        {/* ASSINATURAS — envia o contrato aprovado pra ClickSign (igual venda) */}
        <TabsContent value="assinaturas" className="mt-4">
          {contract ? (
            <LeaseSignaturesTab
              contractId={contract.id}
              contractStatus={contract.status}
            />
          ) : (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                Gere o contrato primeiro para habilitar o envio para assinatura.
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* GARANTIAS */}
        <TabsContent value="garantias" className="mt-4">
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" /> Garantia locatícia
              </CardTitle>
            </CardHeader>
            <CardContent>
              {lease?.guarantee ? (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <Field
                    label="Tipo"
                    value={GARANTIA_TIPO_LABELS[lease.guarantee.tipo] ?? lease.guarantee.tipo}
                  />
                  <Field label="Status" value={lease.guarantee.status} />
                  <Field label="Provedor" value={lease.guarantee.provider} />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nenhuma garantia cadastrada para este contrato.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* VISTORIA */}
        <TabsContent value="vistoria" className="mt-4">
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <ClipboardCheck className="h-4 w-4" /> Vistorias
              </CardTitle>
              <Button variant="outline" size="sm" asChild>
                <a href="/locacao/vistorias">
                  <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> Gerenciar
                </a>
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {lease && lease.inspections.length > 0 ? (
                lease.inspections.map((i) => (
                  <div key={i.id} className="flex items-center justify-between text-sm">
                    <span className="capitalize">Vistoria de {i.tipo}</span>
                    <Badge variant="outline">{i.status}</Badge>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nenhuma vistoria. Crie o laudo de entrada antes da entrega das chaves.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* SEGUROS */}
        <TabsContent value="seguros" className="mt-4">
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Umbrella className="h-4 w-4" /> Seguros (incêndio / fiança)
              </CardTitle>
              <Button variant="outline" size="sm" asChild>
                <a href="/locacao/seguros">
                  <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> Gerenciar
                </a>
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {lease && lease.insurancePolicies.length > 0 ? (
                lease.insurancePolicies.map((p) => (
                  <div key={p.id} className="flex items-center justify-between text-sm">
                    <span>{p.seguradora}</span>
                    <Badge variant="outline">{p.status}</Badge>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">Nenhuma apólice contratada.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* COBRANÇA — comissão + criar administração */}
        <TabsContent value="cobranca" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Receipt className="h-4 w-4" /> Cobrança e administração
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {lease ? (
                <>
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <Field label="Aluguel" value={BRL(lease.valorAluguel)} />
                    <Field label="Taxa adm" value={`${lease.taxaAdminPercent}%`} />
                    <Field label="Dia venc." value={`Dia ${lease.diaVencimento}`} />
                    <Field label="Status" value={lease.status} />
                  </div>
                  <Separator />
                  {lease.status !== "ativo" ? (
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <p className="text-sm text-muted-foreground max-w-md">
                        Criar a administração ativa o contrato no painel de locação e habilita a
                        geração mensal de cobranças de aluguel.
                      </p>
                      <Button onClick={criarAdministracao} disabled={activating}>
                        {activating ? "Criando..." : "Criar administração"}
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Últimas competências</p>
                      {lease.rentCharges.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          Nenhuma cobrança gerada ainda. O agendador materializa a competência do mês.
                        </p>
                      ) : (
                        lease.rentCharges.map((r) => (
                          <div key={r.id} className="flex items-center justify-between text-sm">
                            <span>{r.competencia}</span>
                            <span>{BRL(r.valorBase)}</span>
                            <Badge variant="outline">{r.status}</Badge>
                          </div>
                        ))
                      )}
                      <Button variant="outline" size="sm" asChild className="mt-2">
                        <a href="/locacao/cobrancas">
                          <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> Ver todas as cobranças
                        </a>
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  A administração é criada após a geração do contrato.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
