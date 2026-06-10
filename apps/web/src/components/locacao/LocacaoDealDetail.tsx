"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ContractEditorPage } from "@/components/contracts/ContractEditorPage";
import { LeaseSignaturesTab } from "@/components/locacao/LeaseSignaturesTab";
import { LocacaoDealHeaderActions } from "@/components/locacao/LocacaoDealHeaderActions";
import { LocacaoDadosTab } from "@/components/locacao/LocacaoDadosTab";
import {
  LocacaoDocumentsTab,
  type LocacaoAttachment,
} from "@/components/locacao/LocacaoDocumentsTab";
import { DealProgressTimeline } from "@/components/pipeline/DealProgressTimeline";
import { LostDealBanner } from "@/components/pipeline/LostDealBanner";
import { Field } from "@/components/locacao/lease-detail/LeaseSection";
import { GARANTIA_TIPO_LABELS } from "@/lib/locacao/validators";
import {
  FileText,
  ExternalLink,
  ShieldCheck,
  ClipboardCheck,
  Umbrella,
  Receipt,
  Building2,
} from "lucide-react";
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
    formToken: string | null;
    dataJson: Record<string, unknown>;
    lostAt: string | null;
    lostReason: string | null;
    formOpenedAt: string | null;
    formCompletedAt: string | null;
    contractSignedAt: string | null;
    chargeCreatedAt: string | null;
    attachments: LocacaoAttachment[];
  };
  contract: ContractProp | null;
  versions: VersionsProp;
  lease: LeaseProp | null;
  /** Modo simplificado (LOCACAO_SIMPLIFIED_MODE): mostra só Dados, Contrato,
   *  Documentos e Assinaturas; esconde as abas de administração. */
  simplified?: boolean;
}

const BRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function LocacaoDealDetail({ deal, contract, versions, lease, simplified = false }: LocacaoDealDetailProps) {
  const router = useRouter();
  const [tab, setTab] = useState("dados");
  const [activating, setActivating] = useState(false);

  const isLost = deal.lostAt !== null;
  const readyForAdm =
    (deal.stageName === "Assinado" || deal.stageName === "Cobrança Gerada") &&
    lease !== null &&
    lease.status !== "ativo";

  const locadores =
    (deal.dataJson.locadores as { nome?: string; razao_social?: string }[] | undefined) ?? [];
  const locatarios =
    (deal.dataJson.locatarios as { nome?: string; razao_social?: string }[] | undefined) ?? [];
  const garantiaTipo = (deal.dataJson.garantia as { tipo?: string } | undefined)?.tipo;

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
      {/* Header: título editável + ações (paridade com o DealDetail de vendas) */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            {deal.stageName && <Badge variant="secondary">{deal.stageName}</Badge>}
            {lease && <Badge variant="outline">Locação · {lease.status}</Badge>}
          </div>
          <LocacaoDealHeaderActions
            dealId={deal.id}
            title={deal.title}
            stageName={deal.stageName}
            formToken={deal.formToken}
            hasContract={contract !== null}
            isLost={isLost}
          />
        </div>
        <Button variant="outline" asChild>
          <a href="/pipeline/locacao">Voltar ao pipeline</a>
        </Button>
      </div>

      {/* Banner de perdido OU timeline SLA */}
      {isLost && deal.lostAt ? (
        <LostDealBanner lostAt={deal.lostAt} lostReason={deal.lostReason} />
      ) : (
        <DealProgressTimeline
          kind="locacao"
          variant="full"
          currentStageName={deal.stageName}
          formOpenedAt={deal.formOpenedAt}
          formCompletedAt={deal.formCompletedAt}
          contractSignedAt={deal.contractSignedAt}
          chargeCreatedAt={deal.chargeCreatedAt}
          commissionPaidAt={null}
        />
      )}

      {/* Handoff pra ADM: contrato assinado e administração ainda não criada */}
      {readyForAdm && !isLost && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20 px-4 py-3">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-start gap-3">
              <Building2 className="h-5 w-5 mt-0.5 shrink-0 text-emerald-600" />
              <div>
                <p className="font-medium text-emerald-800 dark:text-emerald-300">
                  Contrato assinado — pronto pra administração
                </p>
                <p className="text-sm text-emerald-700/80 dark:text-emerald-400/80">
                  Criar a administração ativa o contrato e habilita as cobranças
                  mensais de aluguel.
                </p>
              </div>
            </div>
            <Button
              onClick={criarAdministracao}
              disabled={activating}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {activating ? "Criando..." : "Criar administração"}
            </Button>
          </div>
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="dados">Dados</TabsTrigger>
          <TabsTrigger value="contrato">Contrato</TabsTrigger>
          <TabsTrigger value="documentos">Documentos</TabsTrigger>
          <TabsTrigger value="assinaturas">Assinaturas</TabsTrigger>
          {!simplified && <TabsTrigger value="garantias">Garantias</TabsTrigger>}
          {!simplified && <TabsTrigger value="vistoria">Vistoria</TabsTrigger>}
          {!simplified && <TabsTrigger value="seguros">Seguros</TabsTrigger>}
          {!simplified && <TabsTrigger value="cobranca">Cobrança</TabsTrigger>}
        </TabsList>

        {/* DADOS — visão do form.dataJson (paridade com a aba Dados de vendas) */}
        <TabsContent value="dados" className="mt-4">
          <LocacaoDadosTab
            dataJson={deal.dataJson}
            formToken={deal.formToken}
            formStatus={deal.formStatus}
          />
        </TabsContent>

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
                    : "O contrato é gerado quando o cliente finaliza o formulário público, ou pelo botão \"Gerar contrato\" acima."}
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* DOCUMENTOS — pasta do deal com classificar/extrair/excluir (paridade vendas) */}
        <TabsContent value="documentos" className="mt-4">
          <LocacaoDocumentsTab
            dealId={deal.id}
            attachments={deal.attachments}
            locadores={locadores}
            locatarios={locatarios}
            hasFiador={garantiaTipo === "fiador"}
          />
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
