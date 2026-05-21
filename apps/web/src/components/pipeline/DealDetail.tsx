"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { FileText, ExternalLink, ArrowLeft, ShieldCheck, Copy, Wallet, FileSignature, Trash2, FileX, RefreshCw, XOctagon, RotateCcw } from "lucide-react";
import { MarkLostDialog } from "@/components/pipeline/MarkLostDialog";
import { cn } from "@/lib/utils";
import { DocumentCard, type DocumentCardData } from "@/components/forms/DocumentCard";
import type { SelectGroup } from "@/components/forms/NativeSelect";
import type { Assignment, DocumentKind } from "@/lib/forms/extracted-to-form";
import { CertidoesTab } from "@/components/pipeline/CertidoesTab";
import { SignaturesTab } from "@/components/pipeline/SignaturesTab";
import { CommissionChargeDialog } from "@/components/pipeline/CommissionChargeDialog";
import { CommissionChargeList } from "@/components/pipeline/CommissionChargeList";
import { DealProgressTimeline } from "@/components/pipeline/DealProgressTimeline";
import { toast } from "sonner";
import Link from "next/link";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Parte = {
  nome?: string;
  razao_social?: string;
  tipo_pessoa?: string;
  cpf?: string;
  cnpj?: string;
  rg?: string;
  nacionalidade?: string;
  estado_civil?: string;
  profissao?: string;
  email?: string;
  endereco?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  cep?: string;
  conjuge?: {
    nome?: string;
    cpf?: string;
    email?: string;
    incluir_como_signatario?: boolean;
  };
};

type Imovel = {
  rua?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  cep?: string;
  matricula?: string;
  cartorio?: string;
  inscricao_iptu?: string;
  descricao?: string;
};

interface DealDetailProps {
  deal: {
    id: string;
    title: string;
    value: number | null;
    createdAt: Date;
    commissionPaidAt: Date | null;
    lostAt: Date | null;
    lostReason: string | null;
    stage: { name: string; color: string | null };
    form: {
      id: string;
      token: string;
      dataJson: unknown;
      status: string;
      createdAt: Date;
      completedAt: Date | null;
      attachments: {
        id: string;
        filename: string;
        mime: string;
        category: string | null;
        url: string;
        extractedData: unknown;
        createdAt: Date;
      }[];
    } | null;
    attachments: {
      id: string;
      filename: string;
      mime: string;
      category: string | null;
      url: string;
      extractedData: unknown;
      source: string;
      createdAt: Date;
    }[];
    contracts: { id: string; version: number; status: string; template: { name: string } | null; createdAt: Date }[];
    envelopes: { closedAt: Date | null }[];
    commissionCharges: { createdAt: Date }[];
  };
}

const VALID_TABS = new Set([
  "dados",
  "anexos",
  "certidoes",
  "contratos",
  "assinaturas",
  "pagamentos",
]);

export function DealDetail({ deal }: DealDetailProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const initialTab = tabParam && VALID_TABS.has(tabParam) ? tabParam : "dados";
  const [activeTab, setActiveTab] = useState(initialTab);
  const [generating, setGenerating] = useState(false);
  const [confirmDuplicateOpen, setConfirmDuplicateOpen] = useState(false);
  const [chargeDialogOpen, setChargeDialogOpen] = useState(false);
  const [chargeDialogMode, setChargeDialogMode] = useState<
    "commission_from_deal" | "avulsa_in_deal"
  >("commission_from_deal");
  const [chargeRefreshKey, setChargeRefreshKey] = useState(0);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteFormToo, setDeleteFormToo] = useState(false);
  const [deleteContractsDialogOpen, setDeleteContractsDialogOpen] = useState(false);
  const [deletingContracts, setDeletingContracts] = useState(false);
  const [pendingAttachmentId, setPendingAttachmentId] = useState<string | null>(null);
  const [deletingAttachment, setDeletingAttachment] = useState(false);
  const [pendingDeleteContractId, setPendingDeleteContractId] = useState<string | null>(null);
  const [deletingContract, setDeletingContract] = useState(false);
  const [reExtracting, setReExtracting] = useState(false);
  const [markLostDialogOpen, setMarkLostDialogOpen] = useState(false);
  const [markingPaid, setMarkingPaid] = useState(false);
  const [reopening, setReopening] = useState(false);

  const stageName = deal.stage.name;
  const isLost = stageName === "Negócio perdido";
  const isCommissionPaid = stageName === "Comissão paga";
  const isTerminal = isLost || isCommissionPaid;

  async function handleMarkCommissionPaid() {
    setMarkingPaid(true);
    try {
      const res = await fetch(
        `/api/pipeline/deals/${deal.id}/mark-commission-paid`,
        { method: "POST" }
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success("Comissão marcada como paga!");
        router.refresh();
      } else {
        toast.error(data.error || "Erro ao marcar comissão paga");
      }
    } catch {
      toast.error("Erro de conexão");
    } finally {
      setMarkingPaid(false);
    }
  }

  async function handleReopen() {
    setReopening(true);
    try {
      const res = await fetch(`/api/pipeline/deals/${deal.id}/reopen`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success(`Negócio reaberto em "${data.stageName}"`);
        router.refresh();
      } else {
        toast.error(data.error || "Erro ao reabrir negócio");
      }
    } catch {
      toast.error("Erro de conexão");
    } finally {
      setReopening(false);
    }
  }

  // Detecta deal com contrato importado (templateId=null). UI muda em alguns
  // pontos: esconde "Confeccionar Contrato" (substituído por "Abrir contrato"),
  // mostra botão "Re-extrair dados" na aba Dados, abre porta para envelopes
  // avulsos via aba Assinaturas.
  const importedContract = deal.contracts.find((c) => c.template === null);
  const isImportedDeal = Boolean(importedContract);
  const latestImportedContractId = importedContract?.id ?? null;

  async function handleReExtract() {
    if (!latestImportedContractId) return;
    setReExtracting(true);
    try {
      const res = await fetch(
        `/api/contracts/${latestImportedContractId}/re-extract`,
        { method: "POST" }
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Falha ao re-extrair dados");
        return;
      }
      toast.success(
        `Extração concluída: ${data.fieldsCount ?? 0} campos atualizados.`
      );
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro de rede");
    } finally {
      setReExtracting(false);
    }
  }

  async function doGenerateContract() {
    setGenerating(true);
    const res = await fetch(
      `/api/pipeline/deals/${deal.id}/generate-contract`,
      { method: "POST" }
    );
    const data = await res.json();
    setGenerating(false);
    if (res.ok) {
      router.push(`/contracts/${data.contractId}`);
    } else {
      toast.error(data.error || "Erro ao gerar contrato");
    }
  }

  function handleGenerateContract() {
    if (deal.contracts.length > 0) {
      setConfirmDuplicateOpen(true);
      return;
    }
    doGenerateContract();
  }

  function handleCopyFormLink() {
    if (!deal.form) return;
    const url = `${window.location.origin}/f/${deal.form.token}`;
    navigator.clipboard.writeText(url);
    toast.success("Link do formulário copiado!");
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const url = `/api/pipeline/deals/${deal.id}${deleteFormToo ? "?deleteForm=true" : ""}`;
      const res = await fetch(url, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        const c = data?.deleted;
        toast.success(
          `Negócio excluído (${c?.contracts ?? 0} contrato(s), ${c?.attachments ?? 0} anexo(s))`
        );
        router.push("/pipeline");
      } else if (res.status === 409) {
        toast.error(data?.error || "Não foi possível excluir — envelope ClickSign em curso");
      } else {
        toast.error(data?.error || "Erro ao excluir negócio");
      }
    } catch {
      toast.error("Erro de conexão");
    } finally {
      setDeleting(false);
      setDeleteDialogOpen(false);
    }
  }

  async function handleDeleteContracts() {
    setDeletingContracts(true);
    try {
      const res = await fetch(`/api/pipeline/deals/${deal.id}/contracts`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        const c = data?.deleted;
        toast.success(
          `${c?.contracts ?? 0} contrato(s) excluído(s) (${c?.googleDocsTrashed ?? 0} GDocs na lixeira)`
        );
        router.refresh();
      } else if (res.status === 409) {
        toast.error(data?.error || "Não foi possível excluir contratos");
      } else {
        toast.error(data?.error || "Erro ao excluir contratos");
      }
    } catch {
      toast.error("Erro de conexão");
    } finally {
      setDeletingContracts(false);
      setDeleteContractsDialogOpen(false);
    }
  }

  async function handleDeleteAttachment(attachmentId: string) {
    setDeletingAttachment(true);
    try {
      const res = await fetch(
        `/api/deals/${deal.id}/attachments/${attachmentId}`,
        { method: "DELETE" }
      );
      const data = await res.json().catch(() => null);
      if (res.ok) {
        toast.success("Documento excluído");
        router.refresh();
      } else {
        toast.error(data?.error || "Erro ao excluir documento");
      }
    } catch {
      toast.error("Erro de conexão");
    } finally {
      setDeletingAttachment(false);
      setPendingAttachmentId(null);
    }
  }

  async function handleDeleteContract(contractId: string) {
    setDeletingContract(true);
    try {
      const res = await fetch(`/api/contracts/${contractId}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        toast.success("Rascunho excluído");
        router.refresh();
      } else {
        toast.error(data?.error || "Erro ao excluir rascunho");
      }
    } catch {
      toast.error("Erro de conexão");
    } finally {
      setDeletingContract(false);
      setPendingDeleteContractId(null);
    }
  }

  const formData = deal.form?.dataJson as Record<string, unknown> | null;
  const vendedores = (formData?.vendedores as Parte[]) || [];
  const compradores = (formData?.compradores as Parte[]) || [];
  const testemunhas =
    (formData?.testemunhas as Array<{
      nome?: string;
      cpf?: string;
      email?: string;
      incluir_como_signatario?: boolean;
    }>) || [];
  const comissao =
    (formData?.comissao as {
      corretora_tipo_pessoa?: "fisica" | "juridica";
      imobiliaria_nome?: string;
      imobiliaria_cnpj?: string;
      imobiliaria_email?: string;
      creci?: string;
      incluir_como_signatario?: boolean;
      comissionados?: Array<{
        nome?: string;
        cpf?: string;
        cnpj?: string;
        tipo_pessoa?: string;
        email?: string;
        percentual?: number;
        valor?: number;
        incluir_como_signatario?: boolean;
      }>;
    } | null) || null;
  const imoveis = (formData?.imoveis as Imovel[]) || [];
  const pagamento = formData?.pagamento as
    | {
        valor_total?: number;
        sinal_arras?: number;
        recursos_proprios?: number;
        fgts?: number;
        alienacao_fiduciaria?: number;
      }
    | undefined;

  const formatBRL = (v: number | undefined) =>
    v != null ? `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : "—";

  const formatAddress = (p: Parte | Imovel) => {
    const rua = (p as Parte).endereco || (p as Imovel).rua;
    const parts = [
      rua,
      p.numero && `nº ${p.numero}`,
      p.complemento,
      p.bairro && `Bairro: ${p.bairro}`,
      p.cidade && `${p.cidade}${p.uf ? `/${p.uf}` : ""}`,
      p.cep && `CEP ${p.cep}`,
    ].filter(Boolean);
    return parts.length ? parts.join(", ") : "—";
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start sm:items-center gap-4 flex-wrap">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/pipeline">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Pipeline
          </Link>
        </Button>
        <Separator orientation="vertical" className="h-6" />
        <div>
          <h1 className="text-2xl font-semibold">{deal.title}</h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge
              style={{ backgroundColor: deal.stage.color || undefined }}
              className="text-white text-xs"
            >
              {deal.stage.name}
            </Badge>
            {deal.value != null && (
              <span className="text-sm text-muted-foreground">
                R$ {deal.value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              </span>
            )}
          </div>
        </div>
        <div className="w-full sm:w-auto sm:ml-auto flex gap-2 flex-wrap">
          {deal.form && (
            <>
              <Button variant="outline" size="sm" asChild>
                <a
                  href={`/f/${deal.form.token}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="h-4 w-4 mr-1" />
                  Formulário
                </a>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyFormLink}
                title="Copiar link do formulário para compartilhar"
              >
                <Copy className="h-4 w-4 mr-1" />
                Copiar link
              </Button>
            </>
          )}
          {isImportedDeal && latestImportedContractId ? (
            <Button size="sm" asChild>
              <Link href={`/contracts/${latestImportedContractId}`}>
                <FileText className="h-4 w-4 mr-1" />
                Abrir contrato
              </Link>
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={handleGenerateContract}
              disabled={generating}
            >
              <FileText className="h-4 w-4 mr-1" />
              {generating ? "Gerando..." : "Confeccionar Contrato"}
            </Button>
          )}
          {stageName === "Cobrança emitida" && (
            <Button
              size="sm"
              variant="default"
              className="bg-green-600 hover:bg-green-700"
              onClick={handleMarkCommissionPaid}
              disabled={markingPaid}
            >
              <Wallet className="h-4 w-4 mr-1" />
              {markingPaid ? "Marcando..." : "Marcar comissão paga"}
            </Button>
          )}
          {isLost && (
            <Button
              size="sm"
              variant="default"
              onClick={handleReopen}
              disabled={reopening}
            >
              <RotateCcw className="h-4 w-4 mr-1" />
              {reopening ? "Reabrindo..." : "Reabrir negócio"}
            </Button>
          )}
          {!isTerminal && (
            <Button
              size="sm"
              variant="outline"
              className="text-red-600 border-red-300 hover:bg-red-50 dark:hover:bg-red-950/20"
              onClick={() => setMarkLostDialogOpen(true)}
            >
              <XOctagon className="h-4 w-4 mr-1" />
              Marcar como perdido
            </Button>
          )}
          {deal.contracts.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="text-destructive border-destructive/40 hover:bg-destructive/10"
              onClick={() => setDeleteContractsDialogOpen(true)}
            >
              <FileX className="h-4 w-4 mr-1" />
              Excluir contratos
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="text-destructive border-destructive/40 hover:bg-destructive/10"
            onClick={() => setDeleteDialogOpen(true)}
          >
            <Trash2 className="h-4 w-4 mr-1" />
            Excluir negócio
          </Button>
        </div>
      </div>

      {/* Banner de perdido */}
      {isLost && deal.lostAt && (
        <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/20 px-4 py-3">
          <div className="flex items-start gap-3">
            <XOctagon className="h-5 w-5 mt-0.5 shrink-0 text-red-600" />
            <div className="flex-1">
              <p className="font-medium text-red-700 dark:text-red-400">
                Perdido em{" "}
                {new Date(deal.lostAt).toLocaleDateString("pt-BR", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                })}
              </p>
              {deal.lostReason && (
                <p className="text-sm text-red-700/80 dark:text-red-400/80 mt-0.5">
                  {deal.lostReason}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Timeline horizontal — 6 stages do funil + datas-marco SLA */}
      {!isLost && (
        <DealProgressTimeline
          variant="full"
          currentStageName={deal.stage.name}
          formOpenedAt={deal.form?.createdAt ?? null}
          formCompletedAt={deal.form?.completedAt ?? null}
          contractSignedAt={deal.envelopes[0]?.closedAt ?? null}
          chargeCreatedAt={deal.commissionCharges[0]?.createdAt ?? null}
          commissionPaidAt={deal.commissionPaidAt}
        />
      )}

      <MarkLostDialog
        dealId={deal.id}
        open={markLostDialogOpen}
        onOpenChange={setMarkLostDialogOpen}
      />

      <AlertDialog
        open={deleteContractsDialogOpen}
        onOpenChange={setDeleteContractsDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Excluir todos os contratos deste negócio?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Apagar <strong>{deal.contracts.length}</strong> contrato(s) e
                  todas suas versões. Os Google Docs vão para a lixeira do Drive.
                </p>
                <p>O negócio e o formulário continuam intactos.</p>
                <p className="font-medium">Não pode ser desfeito.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingContracts}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteContracts}
              disabled={deletingContracts}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingContracts ? "Excluindo..." : "Excluir contratos"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!pendingAttachmentId}
        onOpenChange={(open) => !open && setPendingAttachmentId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir este documento?</AlertDialogTitle>
            <AlertDialogDescription>
              O arquivo será removido do negócio. Certidões emitidas que apontavam
              para este documento ficam órfãs (não são apagadas). Não pode ser desfeito.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingAttachment}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => pendingAttachmentId && handleDeleteAttachment(pendingAttachmentId)}
              disabled={deletingAttachment}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingAttachment ? "Excluindo..." : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!pendingDeleteContractId}
        onOpenChange={(open) => !open && setPendingDeleteContractId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir este rascunho?</AlertDialogTitle>
            <AlertDialogDescription>
              O contrato (versão rascunho) será removido, junto com comentários,
              sugestões e histórico. O Google Doc vai para a lixeira do Drive.
              Não pode ser desfeito.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingContract}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                pendingDeleteContractId &&
                handleDeleteContract(pendingDeleteContractId)
              }
              disabled={deletingContract}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingContract ? "Excluindo..." : "Excluir rascunho"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir negócio "{deal.title}"?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>Esta ação remove em cascata:</p>
                <ul className="list-disc pl-5 text-sm">
                  <li>{deal.contracts.length} contrato(s) e suas versões (Google Docs vão pra lixeira do Drive)</li>
                  <li>{deal.attachments.length} anexo(s)</li>
                  <li>Todas as certidões emitidas neste deal</li>
                  <li>Histórico de alterações, comentários e sugestões</li>
                </ul>
                <label className="flex items-center gap-2 mt-3 text-sm">
                  <input
                    type="checkbox"
                    checked={deleteFormToo}
                    onChange={(e) => setDeleteFormToo(e.target.checked)}
                    className="h-4 w-4 rounded border-input"
                  />
                  Excluir também o formulário de origem (não recuperável)
                </label>
                <p className="font-medium pt-2">Não pode ser desfeito.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Excluindo..." : "Excluir definitivamente"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="dados">Dados</TabsTrigger>
          <TabsTrigger value="anexos">
            Documentos ({(deal.form?.attachments.length ?? 0) || deal.attachments.length})
          </TabsTrigger>
          <TabsTrigger value="certidoes">
            <ShieldCheck className="h-3.5 w-3.5 mr-1" />
            Certidões
          </TabsTrigger>
          <TabsTrigger value="contratos">
            Contratos ({deal.contracts.length} {deal.contracts.length === 1 ? "versão" : "versões"})
          </TabsTrigger>
          <TabsTrigger value="assinaturas">
            <FileSignature className="h-3.5 w-3.5 mr-1" />
            Assinaturas
          </TabsTrigger>
          <TabsTrigger value="pagamentos">
            <Wallet className="h-3.5 w-3.5 mr-1" />
            Pagamentos
          </TabsTrigger>
        </TabsList>

        <TabsContent value="dados" className="mt-4">
          {isImportedDeal && (
            <div className="mb-3 flex items-center justify-between rounded-md border border-dashed bg-muted/30 p-3">
              <div className="text-xs text-muted-foreground">
                Dados extraídos do contrato importado pelo OCR. Caso algum
                campo esteja faltando, refaça a extração.
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleReExtract}
                disabled={reExtracting}
              >
                <RefreshCw
                  className={cn(
                    "h-3.5 w-3.5 mr-1",
                    reExtracting && "animate-spin"
                  )}
                />
                {reExtracting ? "Extraindo..." : "Re-extrair dados"}
              </Button>
            </div>
          )}
          {formData ? (
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <details open>
                  <summary className="cursor-pointer list-none">
                    <CardHeader className="flex flex-row items-center justify-between">
                      <CardTitle className="text-sm">Vendedor(es)</CardTitle>
                      <span className="text-xs text-muted-foreground">▾ detalhes</span>
                    </CardHeader>
                  </summary>
                  <CardContent className="space-y-3 pt-0">
                    {vendedores.length > 0 ? (
                      vendedores.map((v, i) => (
                        <div key={i} className="space-y-1 text-sm border-b last:border-b-0 pb-2 last:pb-0">
                          <p className="font-medium">{v.nome || v.razao_social || "—"}</p>
                          {v.tipo_pessoa === "juridica" ? (
                            <>
                              {v.cnpj && <p><span className="text-muted-foreground">CNPJ:</span> {v.cnpj}</p>}
                            </>
                          ) : (
                            <>
                              {v.cpf && <p><span className="text-muted-foreground">CPF:</span> {v.cpf}</p>}
                              {v.rg && <p><span className="text-muted-foreground">RG:</span> {v.rg}</p>}
                              {v.estado_civil && <p><span className="text-muted-foreground">Estado civil:</span> {v.estado_civil}</p>}
                              {v.profissao && <p><span className="text-muted-foreground">Profissão:</span> {v.profissao}</p>}
                              {v.email && <p><span className="text-muted-foreground">E-mail:</span> {v.email}</p>}
                            </>
                          )}
                          <p className="text-muted-foreground text-xs">{formatAddress(v)}</p>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">Não preenchido</p>
                    )}
                  </CardContent>
                </details>
              </Card>

              <Card>
                <details open>
                  <summary className="cursor-pointer list-none">
                    <CardHeader className="flex flex-row items-center justify-between">
                      <CardTitle className="text-sm">Comprador(es)</CardTitle>
                      <span className="text-xs text-muted-foreground">▾ detalhes</span>
                    </CardHeader>
                  </summary>
                  <CardContent className="space-y-3 pt-0">
                    {compradores.length > 0 ? (
                      compradores.map((c, i) => (
                        <div key={i} className="space-y-1 text-sm border-b last:border-b-0 pb-2 last:pb-0">
                          <p className="font-medium">{c.nome || c.razao_social || "—"}</p>
                          {c.tipo_pessoa === "juridica" ? (
                            <>
                              {c.cnpj && <p><span className="text-muted-foreground">CNPJ:</span> {c.cnpj}</p>}
                            </>
                          ) : (
                            <>
                              {c.cpf && <p><span className="text-muted-foreground">CPF:</span> {c.cpf}</p>}
                              {c.rg && <p><span className="text-muted-foreground">RG:</span> {c.rg}</p>}
                              {c.estado_civil && <p><span className="text-muted-foreground">Estado civil:</span> {c.estado_civil}</p>}
                              {c.profissao && <p><span className="text-muted-foreground">Profissão:</span> {c.profissao}</p>}
                              {c.email && <p><span className="text-muted-foreground">E-mail:</span> {c.email}</p>}
                            </>
                          )}
                          <p className="text-muted-foreground text-xs">{formatAddress(c)}</p>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">Não preenchido</p>
                    )}
                  </CardContent>
                </details>
              </Card>

              <Card>
                <details open>
                  <summary className="cursor-pointer list-none">
                    <CardHeader className="flex flex-row items-center justify-between">
                      <CardTitle className="text-sm">Imóvel(is)</CardTitle>
                      <span className="text-xs text-muted-foreground">▾ detalhes</span>
                    </CardHeader>
                  </summary>
                  <CardContent className="space-y-3 pt-0">
                    {imoveis.length > 0 ? (
                      imoveis.map((im, i) => (
                        <div key={i} className="space-y-1 text-sm border-b last:border-b-0 pb-2 last:pb-0">
                          <p className="font-medium">{formatAddress(im)}</p>
                          {im.matricula && <p><span className="text-muted-foreground">Matrícula:</span> {im.matricula}</p>}
                          {im.cartorio && <p><span className="text-muted-foreground">Cartório:</span> {im.cartorio}</p>}
                          {im.inscricao_iptu && <p><span className="text-muted-foreground">Inscrição IPTU:</span> {im.inscricao_iptu}</p>}
                          {im.descricao && <p className="text-muted-foreground text-xs">{im.descricao}</p>}
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">Não preenchido</p>
                    )}
                  </CardContent>
                </details>
              </Card>

              <Card>
                <details open>
                  <summary className="cursor-pointer list-none">
                    <CardHeader className="flex flex-row items-center justify-between">
                      <CardTitle className="text-sm">Pagamento</CardTitle>
                      <span className="text-xs text-muted-foreground">▾ detalhes</span>
                    </CardHeader>
                  </summary>
                  <CardContent className="space-y-1 text-sm pt-0">
                    <p><span className="text-muted-foreground">Valor total:</span> <strong>{formatBRL(pagamento?.valor_total)}</strong></p>
                    {pagamento?.sinal_arras ? <p><span className="text-muted-foreground">Sinal:</span> {formatBRL(pagamento.sinal_arras)}</p> : null}
                    {pagamento?.recursos_proprios ? <p><span className="text-muted-foreground">Recursos próprios:</span> {formatBRL(pagamento.recursos_proprios)}</p> : null}
                    {pagamento?.alienacao_fiduciaria ? <p><span className="text-muted-foreground">Financiamento:</span> {formatBRL(pagamento.alienacao_fiduciaria)}</p> : null}
                    {pagamento?.fgts ? <p><span className="text-muted-foreground">FGTS:</span> {formatBRL(pagamento.fgts)}</p> : null}
                  </CardContent>
                </details>
              </Card>
            </div>
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                Nenhum dado de formulário vinculado.
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="anexos" className="mt-4">
          <DocumentsTab
            dealId={deal.id}
            formAttachments={deal.form?.attachments ?? []}
            formToken={deal.form?.token ?? null}
            fallbackAttachments={deal.attachments}
            vendedores={vendedores}
            compradores={compradores}
            imoveis={imoveis}
            onRequestRemoveDealAttachment={(id) => setPendingAttachmentId(id)}
          />
        </TabsContent>

        <TabsContent value="certidoes" className="mt-4">
          <CertidoesTab
            dealId={deal.id}
            vendedores={vendedores}
            compradores={compradores}
            imoveis={imoveis}
          />
        </TabsContent>

        <TabsContent value="contratos" className="mt-4">
          <div className="space-y-3">
            {deal.contracts.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center">
                  <p className="text-muted-foreground mb-4">
                    Nenhum contrato gerado.
                  </p>
                  <Button onClick={handleGenerateContract} disabled={generating}>
                    {generating ? "Gerando..." : "Confeccionar Contrato"}
                  </Button>
                </CardContent>
              </Card>
            ) : (
              deal.contracts.map((contract) => (
                <Link key={contract.id} href={`/contracts/${contract.id}`}>
                  <Card className="hover:border-primary/40 transition-colors cursor-pointer">
                    <CardContent className="py-4 flex items-center justify-between">
                      <div>
                        <p className="font-medium text-sm">
                          {contract.template?.name ?? "Contrato importado"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Versão {contract.version} -{" "}
                          {contract.createdAt.toLocaleDateString("pt-BR")}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{contract.status}</Badge>
                        {contract.status === "rascunho" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-destructive hover:bg-destructive/10"
                            title="Excluir rascunho"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setPendingDeleteContractId(contract.id);
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="assinaturas" className="mt-4">
          <SignaturesTab
            contracts={deal.contracts.map((c) => ({
              id: c.id,
              version: c.version,
              status: c.status,
              templateName: c.template?.name ?? "Contrato importado",
            }))}
            vendedores={vendedores}
            compradores={compradores}
            testemunhas={testemunhas}
            comissao={comissao}
            dealId={deal.id}
            attachments={deal.attachments.map((a) => ({
              id: a.id,
              filename: a.filename,
              mime: a.mime,
              category: a.category,
            }))}
          />
        </TabsContent>

        <TabsContent value="pagamentos" className="mt-4">
          <div className="space-y-4">
            {!deal.contracts.some((c) => c.status === "aprovado") && (
              <div className="p-3 border rounded-md bg-amber-50 border-amber-300 text-sm text-amber-900 flex items-start gap-2">
                <FileText className="h-4 w-4 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="font-medium">Sem contrato aprovado.</p>
                  <p className="text-xs mt-0.5">
                    Para cobrar a comissão a partir do contrato (com pagador, valor
                    e splits pré-preenchidos), aprove a versão atual na aba{" "}
                    <button
                      type="button"
                      onClick={() => setActiveTab("contratos")}
                      className="underline font-medium hover:text-amber-950"
                    >
                      Contratos
                    </button>
                    . Você pode gerar cobrança avulsa neste deal sem aprovação.
                  </p>
                </div>
              </div>
            )}
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h3 className="text-lg font-semibold">Cobranças</h3>
                <p className="text-sm text-muted-foreground">
                  Gere cobranças de comissão a partir do contrato aprovado.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  onClick={() => {
                    const hasApproved = deal.contracts.some(
                      (c) => c.status === "aprovado"
                    );
                    if (!hasApproved) {
                      toast.error(
                        "Aprove um contrato primeiro — abrindo aba Contratos"
                      );
                      setActiveTab("contratos");
                      return;
                    }
                    setChargeDialogMode("commission_from_deal");
                    setChargeDialogOpen(true);
                  }}
                >
                  <Wallet className="h-4 w-4 mr-1" />
                  Cobrança de comissão
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setChargeDialogMode("avulsa_in_deal");
                    setChargeDialogOpen(true);
                  }}
                >
                  <FileText className="h-4 w-4 mr-1" />
                  Avulsa
                </Button>
              </div>
            </div>
            <CommissionChargeList key={chargeRefreshKey} dealId={deal.id} />
          </div>
        </TabsContent>
      </Tabs>

      <CommissionChargeDialog
        dealId={deal.id}
        open={chargeDialogOpen}
        onOpenChange={setChargeDialogOpen}
        onCreated={() => setChargeRefreshKey((k) => k + 1)}
        mode={chargeDialogMode}
      />

      <AlertDialog open={confirmDuplicateOpen} onOpenChange={setConfirmDuplicateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Criar nova versão do contrato?</AlertDialogTitle>
            <AlertDialogDescription>
              Este negócio já possui {deal.contracts.length} versão(ões). A nova versão (V{Math.max(0, ...deal.contracts.map((c) => c.version)) + 1}) será gerada a partir do template padrão com os dados atuais do negócio.
              <br /><br />
              <strong>Atenção:</strong> as edições manuais ou via Chat IA feitas na versão anterior <strong>não serão transferidas automaticamente</strong>. O histórico das versões anteriores é mantido para consulta.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmDuplicateOpen(false);
                doGenerateContract();
              }}
            >
              Criar Nova Versão
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface FormAttachmentLite {
  id: string;
  filename: string;
  mime: string;
  category: string | null;
  url: string;
  extractedData: unknown;
  createdAt: Date;
}

interface FallbackAttachment {
  id: string;
  filename: string;
  mime: string;
  category: string | null;
  url: string;
  extractedData: unknown;
  source: string;
  createdAt: Date;
}

/**
 * Agrupamento de docs na aba Documentos. Cônjuges e representantes são
 * exibidos junto com a parte titular (vendedor/comprador) — não criam
 * grupo próprio na visualização do deal pra evitar fragmentação.
 */
type DocGroupKind = "vendedor" | "comprador" | "imovel" | "outro";

const KIND_LABELS: Record<DocGroupKind, string> = {
  vendedor: "Parte Vendedora",
  comprador: "Parte Compradora",
  imovel: "Imóvel",
  outro: "Outros",
};

// Categorias de DealAttachment que são certidões/relatórios emitidos pela
// esteira (Infosimples, Serasa, relatório consolidado). Agrupadas numa seção
// dedicada na aba Documentos em vez de espalhadas por parte/imóvel.
const CERTIDAO_CATS = new Set(["certidao", "relatorio_certidoes"]);

function groupKindOf(kind: DocumentKind): DocGroupKind {
  if (kind === "vendedor" || kind === "conjuge_vendedor" || kind === "representante_vendedor") {
    return "vendedor";
  }
  if (kind === "comprador" || kind === "conjuge_comprador" || kind === "representante_comprador") {
    return "comprador";
  }
  if (kind === "imovel") return "imovel";
  return "outro";
}

const PERSON_CATS = new Set(["rg", "cpf", "cnh", "procuracao", "comprovante_residencia"]);
const PROPERTY_CATS = new Set(["matricula", "iptu", "escritura"]);

function resolveKind(
  category: string | null,
  extracted: Record<string, unknown> | null
): DocumentKind {
  const assignment = extracted?.assignment as Assignment | undefined;
  if (assignment?.kind) return assignment.kind;
  if (category && PROPERTY_CATS.has(category)) return "imovel";
  if (category && PERSON_CATS.has(category)) return "vendedor";
  return "outro";
}

/**
 * H.6 (Phase H, 2026-04-18) — rematch contra partes FINAIS do deal.
 * Se o CPF/nome extraído do doc bate com uma parte no dataJson atual
 * (possivelmente corrigida nas etapas 1-2 após o upload), sobrescreve
 * o assignment stored. Garante que correção manual de partes propaga
 * para a aba Documentos sem rework.
 */
function rematchAssignment(
  stored: Assignment | undefined,
  fields: Record<string, unknown> | null,
  vendedores: Parte[],
  compradores: Parte[]
): Assignment | undefined {
  if (!fields) return stored;
  const cpfDigits = typeof fields.cpf_numero === "string"
    ? fields.cpf_numero.replace(/\D/g, "")
    : null;
  const nome = typeof fields.nome_completo === "string"
    ? fields.nome_completo.trim().toLowerCase()
    : typeof fields.titular_nome === "string"
    ? fields.titular_nome.trim().toLowerCase()
    : null;
  const matchIn = (arr: Parte[]): number | null => {
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i];
      const pCpf = typeof p.cpf === "string" ? p.cpf.replace(/\D/g, "") : null;
      if (cpfDigits && pCpf && cpfDigits.length === 11 && cpfDigits === pCpf) return i;
      const pNome = typeof p.nome === "string" ? p.nome.trim().toLowerCase() : null;
      if (nome && pNome && nome === pNome) return i;
    }
    return null;
  };
  const vMatch = matchIn(vendedores);
  if (vMatch !== null) return { kind: "vendedor", index: vMatch };
  const cMatch = matchIn(compradores);
  if (cMatch !== null) return { kind: "comprador", index: cMatch };
  return stored;
}

function DocumentsTab({
  dealId,
  formAttachments,
  formToken,
  fallbackAttachments,
  vendedores,
  compradores,
  imoveis,
  onRequestRemoveDealAttachment,
}: {
  dealId: string;
  formAttachments: FormAttachmentLite[];
  formToken: string | null;
  fallbackAttachments: FallbackAttachment[];
  vendedores: Parte[];
  compradores: Parte[];
  imoveis: Imovel[];
  /** Callback chamado quando o usuário clica no X de um DealAttachment
   *  (Infosimples ou manual). Pai abre AlertDialog de confirmação. */
  onRequestRemoveDealAttachment?: (attachmentId: string) => void;
}) {
  const router = useRouter();
  // Set para identificar quais cards são DealAttachment (têm rota DELETE
  // /api/deals/[dealId]/attachments/[id]). FormAttachments têm sua rota
  // própria mas não é exposto remoção daqui (só dentro do form público).
  const dealAttachmentIds = new Set(fallbackAttachments.map((a) => a.id));
  // Dedupe form↔deal: no finalize os FormAttachments são copiados pra
  // DealAttachment reusando a MESMA url. O DealAttachment é canônico (auth,
  // editável/mov./delet. por aqui), então escondemos o FormAttachment quando
  // já existe a cópia no deal. `formByUrl` deixa a cópia herdar o assignment
  // do form pra deals legados cuja cópia veio sem extractedData.
  const dealUrls = new Set(fallbackAttachments.map((a) => a.url));
  const formByUrl = new Map(formAttachments.map((f) => [f.url, f]));
  const visibleFormAttachments = formAttachments.filter(
    (f) => !dealUrls.has(f.url)
  );
  const hasFormAttachments = visibleFormAttachments.length > 0 && formToken;
  // Certidões emitidas (Infosimples + Serasa) e relatórios consolidados —
  // independem do source. Vão pra seção dedicada "Certidões".
  const certidaoAttachments = fallbackAttachments.filter(
    (att) => att.category != null && CERTIDAO_CATS.has(att.category)
  );
  const certidaoIds = new Set(certidaoAttachments.map((a) => a.id));
  // Demais anexos Infosimples (sem categoria de certidão — raro) seguem o
  // agrupamento por parte via assignment.
  const infosimplesAttachments = fallbackAttachments.filter(
    (att) => att.source === "infosimples" && !certidaoIds.has(att.id)
  );
  const manualFallback = fallbackAttachments.filter(
    (att) => att.source !== "infosimples" && !certidaoIds.has(att.id)
  );

  const hasAnyContent =
    hasFormAttachments ||
    certidaoAttachments.length > 0 ||
    infosimplesAttachments.length > 0 ||
    manualFallback.length > 0;

  if (!hasAnyContent) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground text-sm">
          Nenhum documento anexado. Os documentos enviados durante o preenchimento do
          formulário e as certidões extraídas aparecem aqui organizados.
        </CardContent>
      </Card>
    );
  }

  const groups: Record<DocGroupKind, DocumentCardData[]> = {
    vendedor: [],
    comprador: [],
    imovel: [],
    outro: [],
  };

  // Certidões + relatórios: seção própria, subdividida por parte/imóvel a
  // partir do `assignment` que o executor persiste em cada anexo. O relatório
  // consolidado (sem assignment) cai em "Gerais".
  type CertidaoSubGroup = { key: string; label: string; order: number; rows: DocumentCardData[] };
  const certidaoSubMap = new Map<string, CertidaoSubGroup>();
  const ensureSub = (key: string, label: string, order: number): CertidaoSubGroup => {
    let g = certidaoSubMap.get(key);
    if (!g) {
      g = { key, label, order, rows: [] };
      certidaoSubMap.set(key, g);
    }
    return g;
  };
  for (const att of certidaoAttachments) {
    const card: DocumentCardData = {
      id: att.id,
      filename: att.filename,
      mime: att.mime,
      fileUrl: `/api/deals/${dealId}/attachments/${att.id}/file`,
      status: "ready",
      category: att.category,
      fields: null,
      confidence: null,
      assignment: { kind: "outro", index: 0 },
    };
    const extracted = (att.extractedData as Record<string, unknown> | null) || null;
    const assignment = extracted?.assignment as Assignment | undefined;
    if (att.category === "relatorio_certidoes" || !assignment) {
      ensureSub("gerais", "Gerais", 999).rows.push(card);
      continue;
    }
    const normalized = groupKindOf(assignment.kind);
    const idx = assignment.index ?? 0;
    if (normalized === "vendedor") {
      ensureSub(`v-${idx}`, `Vendedor: ${vendedores[idx]?.nome ?? `Parte ${idx + 1}`}`, idx).rows.push(card);
    } else if (normalized === "comprador") {
      ensureSub(`c-${idx}`, `Comprador: ${compradores[idx]?.nome ?? `Parte ${idx + 1}`}`, 100 + idx).rows.push(card);
    } else if (normalized === "imovel") {
      ensureSub(`i-${idx}`, `Imóvel ${idx + 1}`, 200 + idx).rows.push(card);
    } else {
      ensureSub("outras", "Outras", 900).rows.push(card);
    }
  }
  const certidaoSubGroups = Array.from(certidaoSubMap.values()).sort(
    (a, b) => a.order - b.order
  );
  const certidaoTotal = certidaoSubGroups.reduce((acc, g) => acc + g.rows.length, 0);

  // Form-uploaded documents (OCR autofill) — só os que ainda não têm cópia
  // no deal (visibleFormAttachments); os duplicados aparecem como DealAttachment.
  if (hasFormAttachments) {
    for (const att of visibleFormAttachments) {
      const extracted = (att.extractedData as Record<string, unknown> | null) || null;
      const fields = (extracted?.fields as Record<string, unknown> | null) ?? null;
      const confidence =
        typeof extracted?.confidence === "number"
          ? (extracted.confidence as number)
          : null;
      const storedAssignment = extracted?.assignment as Assignment | undefined;
      // H.6 — rematch against final parties (handles user correction in steps 1-2)
      const rematched = rematchAssignment(storedAssignment, fields, vendedores, compradores);
      const assignment = rematched ?? {
        kind: resolveKind(att.category, extracted),
        index: 0,
      };
      const card: DocumentCardData = {
        id: att.id,
        filename: att.filename,
        mime: att.mime,
        fileUrl: `/api/forms/${formToken}/attachments/${att.id}/file`,
        status: "ready",
        category: att.category,
        fields,
        confidence,
        assignment,
      };
      groups[groupKindOf(assignment.kind)].push(card);
    }
  }

  // Infosimples certidões — grouped via extractedData.assignment persisted by the executor
  for (const att of infosimplesAttachments) {
    const extracted = (att.extractedData as Record<string, unknown> | null) || null;
    const assignment = (extracted?.assignment as Assignment | undefined) ?? {
      kind: "outro" as DocumentKind,
      index: 0,
    };
    const card: DocumentCardData = {
      id: att.id,
      filename: att.filename,
      mime: att.mime,
      fileUrl: `/api/deals/${dealId}/attachments/${att.id}/file`,
      status: "ready",
      category: att.category,
      fields: null,
      confidence: null,
      assignment,
    };
    groups[groupKindOf(assignment.kind)].push(card);
  }

  // DealAttachments manuais / copiados do form. Lê o assignment do próprio
  // extractedData; pra cópias legadas sem ele, herda do FormAttachment de
  // mesma url (formByUrl). Sem nada → "Outros". Dedupe por url cobre deals
  // legados que acumularam linhas duplicadas (cópia rodada > 1× antes do fix).
  const seenManualUrls = new Set<string>();
  for (const att of manualFallback) {
    if (seenManualUrls.has(att.url)) continue;
    seenManualUrls.add(att.url);
    const extracted = (att.extractedData as Record<string, unknown> | null) || null;
    const formMatch = formByUrl.get(att.url);
    const formExtracted =
      (formMatch?.extractedData as Record<string, unknown> | null) || null;
    const assignment =
      (extracted?.assignment as Assignment | undefined) ??
      (formExtracted?.assignment as Assignment | undefined) ?? {
        kind: "outro" as DocumentKind,
        index: 0,
      };
    const fields =
      (extracted?.fields as Record<string, unknown> | null) ??
      (formExtracted?.fields as Record<string, unknown> | null) ??
      null;
    const card: DocumentCardData = {
      id: att.id,
      filename: att.filename,
      mime: att.mime,
      fileUrl: `/api/deals/${dealId}/attachments/${att.id}/file`,
      status: "ready",
      category: att.category,
      fields,
      confidence: null,
      assignment,
    };
    groups[groupKindOf(assignment.kind)].push(card);
  }

  const kinds: DocGroupKind[] = ["vendedor", "comprador", "imovel", "outro"];

  // Opções do seletor "Mover para…" (pastas = partes/imóvel/outros). Valor no
  // formato `${kind}:${index}` que o DocumentCard codifica/decodifica.
  const assignmentOptions: SelectGroup[] = [
    {
      label: "Vendedores",
      options: vendedores.map((v, i) => ({
        value: `vendedor:${i}`,
        label: `Vendedor: ${v.nome || v.razao_social || `Parte ${i + 1}`}`,
      })),
    },
    {
      label: "Compradores",
      options: compradores.map((c, i) => ({
        value: `comprador:${i}`,
        label: `Comprador: ${c.nome || c.razao_social || `Parte ${i + 1}`}`,
      })),
    },
    {
      label: "Imóveis",
      options: imoveis.map((im, i) => ({
        value: `imovel:${i}`,
        label: `Imóvel ${i + 1}${im.cidade ? ` — ${im.cidade}` : ""}`,
      })),
    },
    { label: "Outros", options: [{ value: "outro:0", label: "Outros" }] },
  ].filter((g) => g.options.length > 0);

  const handleReassign = async (id: string, value: string) => {
    const [kind, idxStr] = value.split(":");
    const index = Number.parseInt(idxStr, 10) || 0;
    const res = await fetch(`/api/deals/${dealId}/attachments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignment: { kind, index } }),
    });
    if (res.ok) {
      toast.success("Documento movido");
      router.refresh();
    } else {
      const d = await res.json().catch(() => null);
      toast.error(d?.error || "Erro ao mover documento");
    }
  };

  // reassignable: mostra o seletor "Mover para…" (só faz sentido em
  // DealAttachment, que tem rota PATCH autenticada). Certidões ficam de fora
  // (são auto-classificadas pelo executor).
  const renderDocCard = (doc: DocumentCardData, reassignable = false) => {
    const isDealAttachment = dealAttachmentIds.has(doc.id);
    const canRemove = isDealAttachment && !!onRequestRemoveDealAttachment;
    const canReassign = reassignable && isDealAttachment;
    return (
      <DocumentCard
        key={doc.id}
        doc={doc}
        assignmentOptions={canReassign ? assignmentOptions : []}
        onAssignmentChange={canReassign ? handleReassign : undefined}
        readOnly={!canRemove}
        onRemove={canRemove ? (id) => onRequestRemoveDealAttachment(id) : undefined}
      />
    );
  };

  return (
    <div className="space-y-5">
      {/* Certidões: bloco próprio, subdividido por parte/imóvel (+ Gerais). */}
      {certidaoSubGroups.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              Certidões{" "}
              <span className="text-muted-foreground font-normal">
                ({certidaoTotal})
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {certidaoSubGroups.map((sub) => (
              <div key={sub.key} className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  {sub.label}{" "}
                  <span className="font-normal">({sub.rows.length})</span>
                </p>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {sub.rows.map((doc) => renderDocCard(doc))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {kinds.map((kind) => {
        const items = groups[kind];
        if (items.length === 0) return null;
        return (
          <Card key={kind}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                {KIND_LABELS[kind]}{" "}
                <span className="text-muted-foreground font-normal">
                  ({items.length})
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {items.map((doc) => renderDocCard(doc, true))}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
