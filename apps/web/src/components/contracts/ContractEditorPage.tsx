"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ResizableSheet } from "@/components/ui/resizable-sheet";
import { GoogleDocsEditor } from "./GoogleDocsEditor";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { VersionTimeline } from "./VersionTimeline";
import { ChangeLogPanel } from "./ChangeLogPanel";
import { CommentsPanel } from "./CommentsPanel";
import { AddCommentDialog } from "./AddCommentDialog";
import { SuggestionsToolbar } from "./SuggestionsToolbar";
import { ShareDialog } from "./ShareDialog";
import { ApprovalReviewDialog, type ApprovalReviewData } from "./ApprovalReviewDialog";
import { ContractSettingsPanel } from "./ContractSettingsPanel";
import type {
  ContractSettings,
  LocacaoSettings,
  SettingsFamily,
} from "@/lib/contracts/default-config";
import { ExportDialog } from "@/components/export/ExportDialog";
import { PromoteToTemplateDialog } from "@/components/templates/PromoteToTemplateDialog";
import { useAutoAnalyze } from "@/hooks/useAutoAnalyze";
import {
  ArrowLeft,
  MessageSquare,
  MessageSquareText,
  History,
  Save,
  ShieldCheck,
  ScrollText,
  Lock,
  AlertTriangle,
  AlertCircle,
  Info,
  CloudOff,
  Share2,
  Settings,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

interface ContractData {
  id: string;
  dealId: string;
  dealTitle: string;
  templateName: string;
  version: number;
  status: string;
  htmlContent: string;
  dataJson: Record<string, unknown>;
  messages: { id: string; role: string; content: string }[];
  /** ID da session ativa carregada server-side (a mais recente não-arquivada).
   *  Null quando o contrato ainda não tem nenhuma session. UI cria via POST
   *  quando user envia primeira mensagem. */
  sessionId: string | null;
  exports: { id: string; format: string; url: string; createdAt: string }[];
  googleDocId?: string | null;
  googleDocUrl?: string | null;
  googleDocStatus?: string | null;
}

interface Version {
  id: string;
  version: number;
  createdAt: string;
  status: string;
  isLatest: boolean;
}

interface ContractEditorPageProps {
  contract: ContractData;
  versions: Version[];
  /** CTA "Enviar para assinatura" no banner de contrato aprovado.
   *  - `undefined` (default): link para a aba Assinaturas do DealDetail de
   *    VENDAS (`/deals/[id]?tab=assinaturas`).
   *  - `false`: esconde o CTA (quando o container embute a própria superfície
   *    de assinatura e não quer um CTA duplicado).
   *  - `{ onClick, label }`: CTA customizado — usado em locação/administração
   *    pra trocar de aba ou rolar até o `LeaseSignaturesTab` correto (senão o
   *    operador cairia no módulo de vendas). */
  signCta?: false | { onClick: () => void; label?: string };
  /** Vocabulário da aba Configurações. Default "venda"; locação/administração
   *  passam "locacao" (comarca em texto, multa rescisória em meses). */
  settingsFamily?: SettingsFamily;
  /** Padrão contratual da org (`contractDefaultsJson`) do branch da família —
   *  o piso que a aba Configurações mostra pro que o contrato não gravou. */
  orgDefaults?: ContractSettings | LocacaoSettings;
}

export function ContractEditorPage({
  contract,
  versions,
  signCta,
  settingsFamily = "venda",
  orgDefaults,
}: ContractEditorPageProps) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chatInitialInput, setChatInitialInput] = useState<string>("");
  const [status, setStatus] = useState(contract.status);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [addCommentOpen, setAddCommentOpen] = useState(false);
  const [pendingCommentText, setPendingCommentText] = useState("");
  const [commentsVersion, setCommentsVersion] = useState(0);
  const [reviewData, setReviewData] = useState<ApprovalReviewData | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [aiCommentsCount, setAiCommentsCount] = useState<{
    total: number;
    errors: number;
    warnings: number;
    infos: number;
    maxSeverity: "error" | "warning" | "info" | null;
  }>({ total: 0, errors: 0, warnings: 0, infos: 0, maxSeverity: null });
  const [budget, setBudget] = useState<{ pct: number; spent: number; budget: number } | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  // Sincroniza status quando navega entre versoes (mesma tela, prop muda)
  useEffect(() => {
    setStatus(contract.status);
  }, [contract.id, contract.status]);

  const isApproved = status === "aprovado";
  const googleDocFailureReason =
    contract.googleDocStatus && contract.googleDocStatus.startsWith("error:")
      ? contract.googleDocStatus.slice("error:".length).trim()
      : null;

  const refreshAiCommentsCount = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/contracts/${contract.id}/comments/count?authorType=ai&unresolved=true`
      );
      if (res.ok) {
        const data = await res.json();
        setAiCommentsCount(data);
      }
    } catch {
      // silent
    }
  }, [contract.id]);

  useEffect(() => {
    refreshAiCommentsCount();
  }, [contract.id, commentsVersion, refreshAiCommentsCount]);

  // Budget IA (tokens): refresca em mudanças de comments (que vão junto com
  // chamadas IA) ou abertura. Não polla — eventos discretos bastam.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/contracts/${contract.id}/budget`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setBudget({ pct: data.pct, spent: data.spent, budget: data.budget });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [contract.id, commentsVersion]);

  const handleAnalysisComplete = useCallback(() => {
    setCommentsVersion((v) => v + 1);
    refreshAiCommentsCount();
  }, [refreshAiCommentsCount]);

  useAutoAnalyze(isApproved ? null : contract.id, !isApproved, {
    onAnalysisComplete: handleAnalysisComplete,
  });

  async function submitComment(text: string, overrideSelectedText?: string) {
    const selectedText = overrideSelectedText ?? pendingCommentText;
    const res = await fetch(`/api/contracts/${contract.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, selectedText }),
    });
    if (res.ok) {
      setCommentsVersion((v) => v + 1);
      setCommentsOpen(true);
      toast.success(
        "Comentário adicionado · veja no painel lateral do Google Doc"
      );
    } else {
      const data = await res.json().catch(() => null);
      toast.error(data?.error || "Erro ao criar comentário");
    }
  }

  async function handleSaveVersion() {
    setSaving(true);
    // GDocs mode: backend exporta o HTML atual do Drive. Body vazio evita
    // corromper a versão nova com snapshot stale do client.
    const res = await fetch(`/api/contracts/${contract.id}/version`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    setSaving(false);

    if (res.ok) {
      const data = await res.json();
      toast.success(`Versão ${data.version} salva!`);
      router.refresh();
    } else {
      toast.error("Erro ao salvar versão");
    }
  }

  async function handleApprove(force = false) {
    setApproving(true);
    try {
      const res = await fetch(`/api/contracts/${contract.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Erro ao aprovar");
        return;
      }

      if (data.requiresReview) {
        setReviewData({
          canForce: data.canForce,
          issues: data.issues ?? [],
          errorCount: data.errorCount ?? 0,
          warningCount: data.warningCount ?? 0,
          pendingSuggestions: data.pendingSuggestions ?? 0,
          unresolvedComments: data.unresolvedComments ?? 0,
          errorComments: data.errorComments ?? 0,
        });
        setReviewOpen(true);
        return;
      }

      setStatus("aprovado");
      setReviewOpen(false);
      toast.success("Contrato aprovado!");
      router.refresh();
    } finally {
      setApproving(false);
    }
  }

  // Contratos sem googleDocId não são editáveis após o legacy reset 2026-05-03.
  // Mostra aviso explícito em vez de tela vazia.
  if (!contract.googleDocId) {
    return (
      <div className="space-y-4 max-w-2xl mx-auto py-8">
        <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
          <CloudOff className="h-5 w-5 shrink-0 mt-0.5 text-destructive" />
          <div className="text-sm">
            <p className="font-medium">Contrato sem Google Doc associado</p>
            <p className="text-xs mt-1 text-muted-foreground">
              {googleDocFailureReason ? (
                <>Causa: {googleDocFailureReason.slice(0, 240)}{googleDocFailureReason.length > 240 ? "…" : ""}</>
              ) : (
                "O editor depende do Google Docs e este contrato não tem doc associado."
              )}
            </p>
            <p className="text-xs mt-2 text-muted-foreground">
              Recrie o contrato pelo deal — o sistema cria o GDoc automaticamente.
            </p>
            {googleDocFailureReason?.includes("invalid_grant") && (
              <p className="text-xs mt-2 text-amber-700 dark:text-amber-300">
                <strong>invalid_grant</strong> — o refresh token do Google não é mais
                aceito. Causas comuns: token revogado/rotacionado, quebra de linha
                (<code className="font-mono text-[11px]">\n</code>) escapada ao colar a
                env no Vercel, ou — apenas se o app OAuth estiver em modo Testing —
                expiração de 7 dias. Regenere com{" "}
                <code className="font-mono text-[11px]">
                  npx tsx apps/web/scripts/oauth-bootstrap.ts
                </code>{" "}
                e cole o novo{" "}
                <code className="font-mono text-[11px]">GOOGLE_OWNER_REFRESH_TOKEN</code>{" "}
                no Vercel do ambiente afetado SEM escapar quebras de linha; depois faça redeploy.
              </p>
            )}
          </div>
        </div>
        <Button asChild variant="outline">
          <Link href={`/deals/${contract.dealId}`}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Voltar ao deal
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Approved banner */}
      {isApproved && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-success/30 bg-success/10 p-4 text-success">
          <div className="flex items-center gap-3">
            <Lock className="h-5 w-5 shrink-0" />
            <div>
              <p className="font-medium text-sm">
                Contrato aprovado — edição bloqueada
              </p>
              <p className="text-xs text-success/80">
                Pronto para envio à assinatura ou export PDF/DOCX.
              </p>
            </div>
          </div>
          {signCta === undefined ? (
            <Button asChild size="sm" variant="outline">
              <Link href={`/deals/${contract.dealId}?tab=assinaturas`}>
                Enviar para assinatura
              </Link>
            </Button>
          ) : signCta === false ? null : (
            <Button size="sm" variant="outline" onClick={signCta.onClick}>
              {signCta.label ?? "Enviar para assinatura"}
            </Button>
          )}
        </div>
      )}

      {/* Header - sticky to remain visible while scrolling editor */}
      <div className="flex items-start sm:items-center justify-between gap-2 sm:gap-3 sticky top-0 z-10 bg-background/95 backdrop-blur py-2 -mx-1 px-1 border-b sm:border-0 flex-wrap">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/deals/${contract.dealId}`}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            <span className="hidden sm:inline">{contract.dealTitle}</span>
            <span className="sm:hidden">Voltar</span>
          </Link>
        </Button>
        <Separator orientation="vertical" className="h-6 hidden sm:block" />
        <div className="flex-1 min-w-0">
          <h1 className="font-display text-lg font-semibold tracking-tight truncate">
            {contract.templateName}
          </h1>
          <div className="flex items-center gap-2 mt-0.5">
            <Badge variant="outline" className="tabular-nums">
              v{contract.version}
            </Badge>
            <Badge
              variant={isApproved ? "default" : "outline"}
              className={
                isApproved
                  ? "bg-success text-success-foreground hover:bg-success"
                  : "border-warning/30 bg-warning/10 text-warning"
              }
            >
              {isApproved && <ShieldCheck className="h-3 w-3 mr-1" />}
              {status}
            </Badge>
            {budget && !isApproved && (
              <Badge
                variant="outline"
                className={
                  budget.pct >= 1
                    ? "border-red-300 text-red-700 bg-red-50"
                    : budget.pct >= 0.8
                      ? "border-amber-300 text-amber-700 bg-amber-50"
                      : "border-muted text-muted-foreground"
                }
                title={`${budget.spent.toLocaleString("pt-BR")} / ${budget.budget.toLocaleString("pt-BR")} tokens IA usados neste contrato`}
              >
                IA: {Math.round(budget.pct * 100)}%
              </Badge>
            )}
          </div>
        </div>

        <div className="flex gap-2 flex-wrap w-full sm:w-auto">
          {!isApproved && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setChatOpen(true)}
            >
              <MessageSquare className="h-4 w-4 sm:mr-1" />
              <span className="hidden sm:inline">Chat IA</span>
            </Button>
          )}

          {!isApproved && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings className="h-4 w-4 sm:mr-1" />
              <span className="hidden sm:inline">Configurações</span>
            </Button>
          )}

          {/* Comments with proactive AI badge */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCommentsOpen(true)}
            className="relative"
          >
            <MessageSquareText className="h-4 w-4 sm:mr-1" />
            <span className="hidden sm:inline">Comentários</span>
            {aiCommentsCount.total > 0 && (
              <Badge
                variant={
                  aiCommentsCount.maxSeverity === "error"
                    ? "destructive"
                    : aiCommentsCount.maxSeverity === "warning"
                      ? "default"
                      : "secondary"
                }
                className={`ml-1.5 h-5 min-w-5 px-1 text-[10px] ${
                  aiCommentsCount.maxSeverity === "error"
                    ? "animate-pulse"
                    : aiCommentsCount.maxSeverity === "warning"
                      ? "bg-amber-500 text-white hover:bg-amber-500"
                      : ""
                }`}
              >
                {aiCommentsCount.maxSeverity === "error" && (
                  <AlertCircle className="mr-0.5 h-2.5 w-2.5" />
                )}
                {aiCommentsCount.maxSeverity === "warning" && (
                  <AlertTriangle className="mr-0.5 h-2.5 w-2.5" />
                )}
                {aiCommentsCount.maxSeverity === "info" && (
                  <Info className="mr-0.5 h-2.5 w-2.5" />
                )}
                {aiCommentsCount.total}
              </Badge>
            )}
          </Button>

          {/* Change Log */}
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm">
                <ScrollText className="h-4 w-4 sm:mr-1" />
                <span className="hidden sm:inline">Histórico</span>
              </Button>
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>Histórico de Alterações</SheetTitle>
              </SheetHeader>
              <ChangeLogPanel contractId={contract.id} />
            </SheetContent>
          </Sheet>

          {/* Versions */}
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm">
                <History className="h-4 w-4 sm:mr-1" />
                <span className="hidden sm:inline">Versões</span>
              </Button>
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>Histórico de Versões</SheetTitle>
              </SheetHeader>
              <VersionTimeline
                versions={versions}
                currentId={contract.id}
                dealId={contract.dealId}
              />
            </SheetContent>
          </Sheet>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setShareOpen(true)}
          >
            <Share2 className="h-4 w-4 sm:mr-1" />
            <span className="hidden sm:inline">Compartilhar</span>
          </Button>

          <ExportDialog contractId={contract.id} exports={contract.exports} />

          {contract.googleDocId && (
            <PromoteToTemplateDialog contractId={contract.id} />
          )}

          {!isApproved && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={handleSaveVersion}
                disabled={saving}
              >
                <Save className="h-4 w-4 sm:mr-1" />
                <span className="hidden sm:inline">
                  {saving ? "Salvando..." : "Salvar Versão"}
                </span>
              </Button>
              <Button
                size="sm"
                onClick={() => handleApprove(false)}
                disabled={approving}
              >
                <ShieldCheck className="h-4 w-4 sm:mr-1" />
                <span className="hidden sm:inline">
                  {approving ? "Aprovando..." : "Aprovar"}
                </span>
              </Button>
            </>
          )}
        </div>
      </div>

      {/* SuggestionsToolbar fica acima do iframe Drive — aceitar/rejeitar via API. */}
      {!isApproved && (
        <SuggestionsToolbar
          contractId={contract.id}
          editor={null}
          version={commentsVersion}
          onContentChange={() => {}}
          mode="google_docs"
        />
      )}

      {/* Editor Google Docs (iframe Drive) */}
      <div className="rounded-lg border bg-card overflow-hidden">
        <GoogleDocsEditor
          googleDocId={contract.googleDocId}
          googleDocUrl={contract.googleDocUrl}
          readOnly={isApproved}
          status={status}
        />
      </div>

      {/* Comments Panel */}
      <Sheet open={commentsOpen} onOpenChange={setCommentsOpen}>
        <SheetContent side="right" className="w-full sm:w-[420px]">
          <SheetHeader>
            <SheetTitle>Comentários</SheetTitle>
          </SheetHeader>
          <CommentsPanel
            key={commentsVersion}
            contractId={contract.id}
            onCommentClick={() => {}}
            onCommentResolved={() => {
              setCommentsVersion((v) => v + 1);
              refreshAiCommentsCount();
            }}
            isApproved={isApproved}
            onContentUpdate={() => {}}
            onAddComment={
              !isApproved
                ? () => {
                    setPendingCommentText("");
                    setAddCommentOpen(true);
                  }
                : undefined
            }
          />
        </SheetContent>
      </Sheet>

      {/* Add Comment Dialog */}
      <AddCommentDialog
        open={addCommentOpen}
        selectedText={pendingCommentText}
        onClose={() => setAddCommentOpen(false)}
        onSubmit={submitComment}
        requireSelectedTextInput={!pendingCommentText}
      />

      {/* Share Dialog */}
      <ShareDialog
        open={shareOpen}
        contractId={contract.id}
        onClose={() => setShareOpen(false)}
      />

      {/* Approval Review Dialog */}
      <ApprovalReviewDialog
        open={reviewOpen}
        data={reviewData}
        onClose={() => setReviewOpen(false)}
        onForceApprove={() => handleApprove(true)}
      />

      {/* Chat Panel — ChatPanel ja renderiza seu proprio header com
          titulo + mode toggle + meta buttons. SheetHeader removido pra
          nao duplicar. SR-only title via SheetTitle pra acessibilidade. */}
      {!isApproved && (
        <ResizableSheet
          open={chatOpen}
          onOpenChange={setChatOpen}
          defaultWidth={600}
          storageKey="chat:size"
        >
          <SheetTitle className="sr-only">Assistente Jurídico IA</SheetTitle>
          <ChatPanel
            contractId={contract.id}
            messages={contract.messages}
            initialSessionId={contract.sessionId}
            onContentUpdate={() => {}}
            onChatTurnComplete={() => setCommentsVersion((v) => v + 1)}
            initialInput={chatInitialInput}
          />
        </ResizableSheet>
      )}

      {/* Configurações do contrato — mesmo padrão do chat (ResizableSheet
          próprio), ao lado dele no header. */}
      {!isApproved && (
        <ResizableSheet
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          defaultWidth={520}
          storageKey="contract-settings:size"
        >
          <SheetTitle className="sr-only">Configurações do contrato</SheetTitle>
          <ContractSettingsPanel
            contractId={contract.id}
            dataJson={(contract.dataJson ?? {}) as Record<string, unknown>}
            family={settingsFamily}
            orgDefaults={orgDefaults}
            onSaved={() => {
              // O iframe do Drive é colaborativo e reflete a edição sozinho; o
              // refresh serve pro dataJson do server component.
              router.refresh();
            }}
            onOpenChat={(prompt) => {
              setChatInitialInput(prompt);
              setSettingsOpen(false);
              setChatOpen(true);
            }}
          />
        </ResizableSheet>
      )}

    </div>
  );
}
