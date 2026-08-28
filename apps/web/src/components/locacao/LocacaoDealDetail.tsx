"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
// Import só de tipo: serve pra derivar ContractProp/VersionsProp sem puxar o
// editor pro chunk inicial (o componente entra via next/dynamic abaixo).
import type { ContractEditorPage as ContractEditorPageComponent } from "@/components/contracts/ContractEditorPage";
import type { LocacaoSettings } from "@/lib/contracts/default-config";
import type { LeaseSignerData } from "@/components/locacao/SendLeaseEnvelopeDialog";
import { LocacaoDealHeaderActions } from "@/components/locacao/LocacaoDealHeaderActions";
import { LocacaoDadosTab } from "@/components/locacao/LocacaoDadosTab";
import { SendFormSummaryDialog } from "@/components/forms/SendFormSummaryDialog";
import type { SummarySection } from "@/lib/forms/negotiation-summary";
import type { LocacaoAttachment } from "@/components/locacao/LocacaoDocumentsTab";
import {
  LocacaoCreditAnalysisCard,
  type SerasaJobSummary,
} from "@/components/locacao/LocacaoCreditAnalysisCard";
import { DealProgressTimeline } from "@/components/pipeline/DealProgressTimeline";
import { LostDealBanner } from "@/components/pipeline/LostDealBanner";
import { Field } from "@/components/locacao/lease-detail/LeaseSection";
import type { PolicyView } from "@/components/locacao/lease-detail/SegurosTab";
import type { FiancaConsolidado } from "@/components/locacao/lease-detail/FiancaComparativoCard";
import type { GuaranteeView } from "@/components/locacao/lease-detail/GarantiasTab";
import type { InspectionView } from "@/components/locacao/lease-detail/VistoriaTab";
import Link from "next/link";
import { FileText, ExternalLink, Receipt, Building2, FileSignature } from "lucide-react";
import { DealManagerChip } from "@/components/deals/DealManagerChip";
import { toast } from "sonner";

/**
 * Placeholder enquanto o chunk da aba baixa. A aba inicial ("dados") é
 * estática, então isto só aparece em troca de aba.
 */
function TabLoading() {
  return (
    <div className="min-h-[120px] px-3 py-6 text-sm text-muted-foreground">
      Carregando…
    </div>
  );
}

// Code splitting: abas não-iniciais saem do chunk da página (o custo é
// bundle/parse — o Radix Tabs já desmonta o conteúdo inativo). Sem `ssr: false`.
const ContractEditorPage = dynamic(
  () =>
    import("@/components/contracts/ContractEditorPage").then(
      (m) => m.ContractEditorPage
    ),
  { loading: () => <TabLoading /> }
);
const LeaseSignaturesTab = dynamic(
  () =>
    import("@/components/locacao/LeaseSignaturesTab").then(
      (m) => m.LeaseSignaturesTab
    ),
  { loading: () => <TabLoading /> }
);
const LocacaoAdminContractTab = dynamic(
  () =>
    import("@/components/locacao/LocacaoAdminContractTab").then(
      (m) => m.LocacaoAdminContractTab
    ),
  { loading: () => <TabLoading /> }
);
const LocacaoDocumentsTab = dynamic(
  () =>
    import("@/components/locacao/LocacaoDocumentsTab").then(
      (m) => m.LocacaoDocumentsTab
    ),
  { loading: () => <TabLoading /> }
);
const SegurosTab = dynamic(
  () =>
    import("@/components/locacao/lease-detail/SegurosTab").then(
      (m) => m.SegurosTab
    ),
  { loading: () => <TabLoading /> }
);
const GarantiasTab = dynamic(
  () =>
    import("@/components/locacao/lease-detail/GarantiasTab").then(
      (m) => m.GarantiasTab
    ),
  { loading: () => <TabLoading /> }
);
const VistoriaTab = dynamic(
  () =>
    import("@/components/locacao/lease-detail/VistoriaTab").then(
      (m) => m.VistoriaTab
    ),
  { loading: () => <TabLoading /> }
);
const DealSurveysTab = dynamic(
  () => import("@/components/surveys/DealSurveysTab").then((m) => m.DealSurveysTab),
  { loading: () => <TabLoading /> }
);

type ContractProp = React.ComponentProps<
  typeof ContractEditorPageComponent
>["contract"];
type VersionsProp = React.ComponentProps<
  typeof ContractEditorPageComponent
>["versions"];

interface LeaseProp {
  id: string;
  status: string;
  valorAluguel: number;
  taxaAdminPercent: number;
  diaVencimento: number;
  propertyId: string;
  /** Endereço resumido do imóvel (labels do NovaVistoriaDialog/laudo). */
  propertyLabel: string;
  guarantee: GuaranteeView | null;
  inspections: InspectionView[];
  insurancePolicies: PolicyView[];
  rentCharges: { id: string; competencia: string; valorBase: number; status: string }[];
}

interface LocacaoDealDetailProps {
  /** Seções do resumo consolidado, iguais às do PDF (calculadas no server). */
  formSummarySections?: SummarySection[];
  deal: {
    id: string;
    title: string;
    stageName: string | null;
    formStatus: string | null;
    formToken: string | null;
    formLockedAt: string | null;
    formReopenedAt: string | null;
    /** Gerente responsável (scalar do Deal) — o nome sai do manager-context. */
    managerUserId: string | null;
    dataJson: Record<string, unknown>;
    lostAt: string | null;
    lostReason: string | null;
    archivedAt: string | null;
    formOpenedAt: string | null;
    formCompletedAt: string | null;
    contractSignedAt: string | null;
    chargeCreatedAt: string | null;
    attachments: LocacaoAttachment[];
    /** Proposta que originou o deal (conversão) — chip "Origem: proposta". */
    fromProposal?: {
      id: string;
      title: string;
      convertedWithoutSignature: boolean;
    } | null;
  };
  contract: ContractProp | null;
  versions: VersionsProp;
  /** Contrato de administração (kind="administracao") latest — aba Administração. */
  adminContract: ContractProp | null;
  adminVersions: VersionsProp;
  /** Nome da org (administradora) pra pré-preencher o signatário da imobiliária. */
  orgName?: string;
  lease: LeaseProp | null;
  /** Consentimento LGPD Serasa já registrado no deal. */
  serasaConsent?: boolean;
  /** Consultas Serasa do deal (análise de crédito), mais recentes primeiro. */
  serasaJobs?: SerasaJobSummary[];
  /** Modo simplificado (LOCACAO_SIMPLIFIED_MODE): mostra só Dados, Contrato,
   *  Documentos e Assinaturas; esconde as abas de administração. */
  simplified?: boolean;
  /** Pesquisas de satisfação habilitadas (feature locacao.pesquisas, default OFF). */
  surveysEnabled?: boolean;
  /** Padrão contratual de LOCAÇÃO da org — piso da aba Configurações do editor
   *  (vale pro contrato de locação E pro de administração). */
  orgDefaults?: LocacaoSettings;
}

const BRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type LeaseFormData = {
  locadores?: unknown[];
  locatarios?: unknown[];
  imovel?: Record<string, unknown>;
  aluguel?: Record<string, unknown>;
  garantia?: { tipo?: string; fiador?: unknown } | null;
};

/** Abas Garantias/Vistoria/Seguros antes do LeaseContract existir (stage < Em contrato). */
function SemLeaseCard() {
  return (
    <Card>
      <CardContent className="py-10 text-center text-sm text-muted-foreground">
        Disponível após a geração do contrato (o vínculo de locação nasce junto com o
        instrumento).
      </CardContent>
    </Card>
  );
}

/** Partes do contrato de locação pra popup de assinatura (locador/locatário/fiador). */
function extractLeaseSignerData(dataJson: Record<string, unknown> | null): LeaseSignerData {
  const d = (dataJson ?? {}) as LeaseFormData;
  return {
    locadores: (d.locadores as LeaseSignerData["locadores"]) ?? [],
    locatarios: (d.locatarios as LeaseSignerData["locatarios"]) ?? [],
    garantia: (d.garantia as LeaseSignerData["garantia"]) ?? null,
  };
}

export function LocacaoDealDetail({
  formSummarySections,
  deal,
  contract,
  versions,
  adminContract,
  adminVersions,
  orgName,
  lease,
  serasaConsent = false,
  serasaJobs = [],
  simplified = false,
  surveysEnabled = false,
  orgDefaults,
}: LocacaoDealDetailProps) {
  const router = useRouter();
  // Tab inicial via ?tab= (paridade com o DealDetail de vendas) — permite
  // deep-link tipo /locacao/deals/[id]?tab=vistoria (back-link do editor de laudo).
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const VALID_TABS = [
    "dados",
    "contrato",
    "administracao",
    "documentos",
    "assinaturas",
    "garantias",
    "vistoria",
    "seguros",
    "cobranca",
    // Deep-link ?tab=pesquisas (paridade com vendas) — só quando a feature
    // está ligada, senão cai no default.
    ...(surveysEnabled ? ["pesquisas"] : []),
  ];
  const [tab, setTab] = useState(
    tabParam && VALID_TABS.includes(tabParam) ? tabParam : "dados"
  );
  const [activating, setActivating] = useState(false);

  const isLost = deal.lostAt !== null;
  const inAprovacao = deal.stageName === "Em Aprovação";
  // Lease assinado e administração ainda não ativada — momento do handoff.
  const readyForAdm =
    (deal.stageName === "Assinado" || deal.stageName === "Cobrança Gerada") &&
    lease !== null &&
    lease.status !== "ativo";
  const hasAdminContract = adminContract !== null;
  const adminApproved = adminContract?.status === "aprovado";

  const locadores =
    (deal.dataJson.locadores as { nome?: string; razao_social?: string }[] | undefined) ?? [];
  const locatarios =
    (deal.dataJson.locatarios as { nome?: string; razao_social?: string }[] | undefined) ?? [];
  const garantia = deal.dataJson.garantia as
    | { tipo?: string; fiador?: Record<string, unknown> }
    | undefined;
  // Bloco operador-only que alimenta o contrato de ADMINISTRAÇÃO — coletado no
  // diálogo da aba Administração (não mais na criação do formulário). O
  // LeaseContract é espelho desse mesmo bloco, então o dataJson basta.
  const fiscalAdministracao = deal.dataJson.fiscal as
    | React.ComponentProps<typeof LocacaoAdminContractTab>["fiscal"]
    | undefined;

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

  // Signatários do contrato de administração: proprietários (locadores) +
  // imobiliária (montada no dialog). Reusa o shape de LeaseSignerData.
  const adminSignerData: LeaseSignerData = {
    locadores: (deal.dataJson.locadores as LeaseSignerData["locadores"]) ?? [],
    locatarios: [],
    garantia: null,
  };

  return (
    <div className="space-y-4">
      {/* Header: título editável + ações (paridade com o DealDetail de vendas) */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            {deal.stageName && <Badge variant="secondary">{deal.stageName}</Badge>}
            {lease && <Badge variant="outline">Locação · {lease.status}</Badge>}
            <DealManagerChip
              dealId={deal.id}
              managerUserId={deal.managerUserId}
              managerName={null}
            />
            {deal.fromProposal && (
              <Link
                href={`/pipeline/propostas/${deal.fromProposal.id}`}
                className="inline-flex max-w-[280px] items-center gap-1 text-sm text-muted-foreground hover:underline"
                title={deal.fromProposal.title}
              >
                <FileSignature className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">
                  Origem: proposta {deal.fromProposal.title}
                </span>
                {deal.fromProposal.convertedWithoutSignature && (
                  <span className="shrink-0">(sem assinatura)</span>
                )}
              </Link>
            )}
          </div>
          <LocacaoDealHeaderActions
            dealId={deal.id}
            title={deal.title}
            stageName={deal.stageName}
            formToken={deal.formToken}
            formLockedAt={deal.formLockedAt}
            formStatus={deal.formStatus}
            formCompletedAt={deal.formCompletedAt}
            formReopenedAt={deal.formReopenedAt}
            hasContract={contract !== null}
            isLost={isLost}
            archivedAt={deal.archivedAt}
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

      {/* Análise de crédito — stage "Em Aprovação" (ou histórico de consultas) */}
      {!isLost && (inAprovacao || serasaJobs.length > 0) && (
        <LocacaoCreditAnalysisCard
          dealId={deal.id}
          stageName={deal.stageName}
          hasConsent={serasaConsent}
          jobs={serasaJobs}
        />
      )}

      {/* Handoff pra ADM: contrato de locação assinado e administração não ativada.
          O banner orquestra o contrato de administração (opcional) + a ativação
          do lease. Ativar o lease NÃO exige o contrato de administração
          assinado — é induzido, não obrigatório (gate opcional). */}
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
                  {!hasAdminContract
                    ? "Formalize a administração com o proprietário (opcional) e ative o contrato para habilitar as cobranças mensais."
                    : !adminApproved
                      ? "Conclua o contrato de administração na aba Administração, ou ative direto para habilitar as cobranças mensais."
                      : "Ative o contrato para habilitar as cobranças mensais de aluguel."}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {!hasAdminContract ? (
                <Button
                  variant="outline"
                  onClick={() => setTab("administracao")}
                  className="border-emerald-400 text-emerald-700 hover:bg-emerald-100"
                >
                  <FileSignature className="h-4 w-4 mr-1.5" />
                  Contrato de administração
                </Button>
              ) : !adminApproved ? (
                <Button
                  variant="outline"
                  onClick={() => setTab("administracao")}
                  className="border-emerald-400 text-emerald-700 hover:bg-emerald-100"
                >
                  Continuar na aba Administração
                </Button>
              ) : null}
              <Button
                onClick={criarAdministracao}
                disabled={activating}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                {activating
                  ? "Ativando..."
                  : hasAdminContract
                    ? "Ativar administração"
                    : "Ativar sem contrato"}
              </Button>
            </div>
          </div>
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="dados">Dados</TabsTrigger>
          <TabsTrigger value="contrato">Contrato</TabsTrigger>
          <TabsTrigger value="administracao">Administração</TabsTrigger>
          <TabsTrigger value="documentos">Documentos</TabsTrigger>
          <TabsTrigger value="assinaturas">Assinaturas</TabsTrigger>
          {/* Garantias/Vistoria/Seguros fazem parte da jornada comercial do deal
              (a superfície ADM está suprimida nesta fase) — sempre visíveis. */}
          <TabsTrigger value="garantias">Garantias</TabsTrigger>
          <TabsTrigger value="vistoria">Vistoria</TabsTrigger>
          <TabsTrigger value="seguros">Seguros</TabsTrigger>
          {!simplified && <TabsTrigger value="cobranca">Cobrança</TabsTrigger>}
          {surveysEnabled && <TabsTrigger value="pesquisas">Pesquisas</TabsTrigger>}
        </TabsList>

        {/* DADOS — visão do form.dataJson (paridade com a aba Dados de vendas) */}
        <TabsContent value="dados" className="mt-4">
          {deal.formToken && (
            <div className="mb-3 flex items-center justify-end">
              <SendFormSummaryDialog dealId={deal.id} />
            </div>
          )}
          <LocacaoDadosTab
            summarySections={formSummarySections}
            dealId={deal.id}
            dataJson={deal.dataJson}
            formToken={deal.formToken}
            formStatus={deal.formStatus}
            dealTitle={deal.title}
          />
        </TabsContent>

        {/* CONTRATO — editor Google Docs + agente de IA (especializado em locação) */}
        <TabsContent value="contrato" className="mt-4">
          {contract ? (
            <ContractEditorPage
              contract={contract}
              versions={versions}
              settingsFamily="locacao"
              orgDefaults={orgDefaults}
              // Locação tem aba Assinaturas própria — o CTA default do editor
              // levaria à tela de VENDAS `/deals/[id]`.
              signCta={{ onClick: () => setTab("assinaturas") }}
            />
          ) : (
            <Card>
              <CardContent className="py-10 text-center">
                <FileText className="mx-auto h-10 w-10 text-muted-foreground" />
                <p className="mt-3 text-sm font-medium">Contrato ainda não gerado</p>
                <p className="text-sm text-muted-foreground">
                  {deal.formStatus === "completo"
                    ? "A geração falhou — ative ou envie um modelo de locação em Configurações → Modelos."
                    : "O contrato é gerado quando o cliente finaliza o formulário público, ou pelo botão \"Gerar contrato\" acima."}
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ADMINISTRAÇÃO — contrato imobiliária ↔ proprietário (gerar/editar/assinar) */}
        <TabsContent value="administracao" className="mt-4">
          <LocacaoAdminContractTab
            dealId={deal.id}
            adminContract={adminContract}
            adminVersions={adminVersions}
            signerData={adminSignerData}
            imobiliariaNome={orgName}
            orgDefaults={orgDefaults}
            fiscal={fiscalAdministracao}
          />
        </TabsContent>

        {/* DOCUMENTOS — pasta do deal com classificar/extrair/excluir (paridade vendas) */}
        <TabsContent value="documentos" className="mt-4">
          <LocacaoDocumentsTab
            dealId={deal.id}
            attachments={deal.attachments}
            locadores={locadores}
            locatarios={locatarios}
            garantia={garantia}
          />
        </TabsContent>

        {/* ASSINATURAS — envia o contrato aprovado pra ClickSign (igual venda) */}
        <TabsContent value="assinaturas" className="mt-4">
          {contract ? (
            <LeaseSignaturesTab
              contractId={contract.id}
              contractStatus={contract.status}
              data={extractLeaseSignerData(contract.dataJson)}
              leaseContractId={lease?.id}
            />
          ) : (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                Gere o contrato primeiro para habilitar o envio para assinatura.
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* GARANTIAS — resumo + contratação/substituição por modalidade */}
        <TabsContent value="garantias" className="mt-4">
          {lease ? (
            <GarantiasTab
              leaseContractId={lease.id}
              valorAluguel={lease.valorAluguel}
              guarantee={lease.guarantee}
            />
          ) : (
            <SemLeaseCard />
          )}
        </TabsContent>

        {/* VISTORIA — laudos do contrato + editor de confecção */}
        <TabsContent value="vistoria" className="mt-4">
          {lease ? (
            <VistoriaTab
              leaseContractId={lease.id}
              leaseLabel={`Contrato — ${lease.propertyLabel}`}
              propertyId={lease.propertyId}
              propertyLabel={lease.propertyLabel}
              inspections={lease.inspections}
            />
          ) : (
            <SemLeaseCard />
          )}
        </TabsContent>

        {/* SEGUROS — contratação guiada do seguro incêndio + apólices */}
        <TabsContent value="seguros" className="mt-4">
          {lease ? (
            <SegurosTab
              leaseContractId={lease.id}
              valorAluguel={lease.valorAluguel}
              policies={lease.insurancePolicies}
              fiancaConsolidado={
                lease.guarantee?.tipo === "seguro_fianca"
                  ? (lease.guarantee.dadosJson as FiancaConsolidado | null)
                  : null
              }
            />
          ) : (
            <SemLeaseCard />
          )}
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
        {surveysEnabled && (
          <TabsContent value="pesquisas" className="mt-4">
            <DealSurveysTab dealId={deal.id} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
