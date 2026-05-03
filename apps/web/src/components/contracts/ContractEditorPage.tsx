"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
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
import { ContractEditor, type ContractEditorHandle } from "./ContractEditor";
import { GoogleDocsEditor } from "./GoogleDocsEditor";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { VersionTimeline } from "./VersionTimeline";
import { ChangeLogPanel } from "./ChangeLogPanel";
import { CommentsPanel } from "./CommentsPanel";
import { AddCommentDialog } from "./AddCommentDialog";
import { SuggestionsToolbar } from "./SuggestionsToolbar";
import { ShareDialog } from "./ShareDialog";
import { ApprovalReviewDialog, type ApprovalReviewData } from "./ApprovalReviewDialog";
import { ExportDialog } from "@/components/export/ExportDialog";
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
}

export function ContractEditorPage({
  contract,
  versions,
}: ContractEditorPageProps) {
  const router = useRouter();
  const [htmlContent, setHtmlContent] = useState(contract.htmlContent);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInitialInput, setChatInitialInput] = useState<string>("");
  const [status, setStatus] = useState(contract.status);
  const [autoSaveStatus, setAutoSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const savedContentRef = useRef(contract.htmlContent);

  // Sincroniza o conteudo e status quando navega entre versoes (mesma tela, prop muda)
  useEffect(() => {
    setHtmlContent(contract.htmlContent);
    setStatus(contract.status);
    savedContentRef.current = contract.htmlContent;
    setAutoSaveStatus("idle");
  }, [contract.id, contract.htmlContent, contract.status]);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [addCommentOpen, setAddCommentOpen] = useState(false);
  const [pendingCommentText, setPendingCommentText] = useState("");
  const [commentsVersion, setCommentsVersion] = useState(0);
  const [reviewData, setReviewData] = useState<ApprovalReviewData | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const editorRef = useRef<ContractEditorHandle>(null);
  const [editorInstance, setEditorInstance] = useState<Editor | null>(null);
  const [aiCommentsCount, setAiCommentsCount] = useState<{
    total: number;
    errors: number;
    warnings: number;
    infos: number;
    maxSeverity: "error" | "warning" | "info" | null;
  }>({ total: 0, errors: 0, warnings: 0, infos: 0, maxSeverity: null });
  const [budget, setBudget] = useState<{ pct: number; spent: number; budget: number } | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  const isApprovedOrVoid = status === "aprovado";
  const isGoogleDocsBacked = !!contract.googleDocId;
  const googleDocFailureReason =
    contract.googleDocStatus && contract.googleDocStatus.startsWith("error:")
      ? contract.googleDocStatus.slice("error:".length).trim()
      : null;

  // Auto-save: debounced PATCH when htmlContent changes (TipTap-only).
  // Quando o contrato é Google Doc, o doc é a fonte de verdade do texto —
  // PATCHar htmlContent não tem efeito visível e ainda atropela o snapshot
  // que o accept/reject de suggestions persiste. Skip o auto-save inteiro.
  useEffect(() => {
    if (isApprovedOrVoid) return;
    if (isGoogleDocsBacked) return;
    if (htmlContent === savedContentRef.current) return;
    const timer = setTimeout(async () => {
      setAutoSaveStatus("saving");
      try {
        const res = await fetch(`/api/contracts/${contract.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ htmlContent }),
        });
        if (!res.ok) throw new Error("save failed");
        savedContentRef.current = htmlContent;
        setAutoSaveStatus("saved");
        setTimeout(() => setAutoSaveStatus("idle"), 1500);
      } catch {
        setAutoSaveStatus("error");
      }
    }, 1500);
    return () => clearTimeout(timer);
  }, [htmlContent, contract.id, isApprovedOrVoid, isGoogleDocsBacked]);

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

  useAutoAnalyze(
    editorInstance,
    isApprovedOrVoid ? null : contract.id,
    !isApprovedOrVoid,
    {
      onAnalysisComplete: handleAnalysisComplete,
      mode: isGoogleDocsBacked ? "google_docs" : "tiptap",
    }
  );

  // Apply comment marks for AI-generated comments that don't yet have an anchor
  // in the editor. Runs whenever comments change or the editor becomes ready.
  useEffect(() => {
    if (!editorInstance || isApprovedOrVoid) return;
    let cancelled = false;
    async function applyAIMarks() {
      try {
        const res = await fetch(
          `/api/contracts/${contract.id}/comments?authorType=ai&unresolved=true`
        );
        if (!res.ok) return;
        const comments: Array<{ anchorId: string; selectedText: string }> = await res.json();
        if (cancelled) return;
        for (const c of comments) {
          if (!c.anchorId || !c.selectedText) continue;
          if (typeof document !== "undefined") {
            const existing = document.querySelector(`[data-comment-id="${c.anchorId}"]`);
            if (existing) continue;
          }
          editorRef.current?.applyCommentMarkByText(c.anchorId, c.selectedText);
        }
      } catch {
        // silent
      }
    }
    applyAIMarks();
    return () => {
      cancelled = true;
    };
  }, [editorInstance, contract.id, commentsVersion, isApprovedOrVoid]);

  function handleAddComment(selectedText: string) {
    setPendingCommentText(selectedText);
    setAddCommentOpen(true);
  }

  async function submitComment(text: string, overrideSelectedText?: string) {
    const selectedText = overrideSelectedText ?? pendingCommentText;
    const res = await fetch(`/api/contracts/${contract.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, selectedText }),
    });
    if (res.ok) {
      const created = await res.json();
      editorRef.current?.applyCommentMark(created.anchorId);
      setCommentsVersion((v) => v + 1);
      setCommentsOpen(true);
      toast.success(
        isGoogleDocsBacked
          ? "Comentário adicionado · veja no painel lateral do Google Doc"
          : "Comentário adicionado"
      );
    } else {
      const data = await res.json().catch(() => null);
      toast.error(data?.error || "Erro ao criar comentário");
    }
  }

  function handleCommentClick(anchorId: string) {
    editorRef.current?.scrollToComment(anchorId);
  }

  function handleCommentResolved(anchorId: string) {
    editorRef.current?.removeCommentMark(anchorId);
  }

  function handleAskAI(selectedText: string) {
    const trimmed = selectedText.trim();
    const preview = trimmed.length > 400 ? `${trimmed.slice(0, 400)}…` : trimmed;
    setChatInitialInput(`> ${preview.replace(/\n/g, "\n> ")}\n\n`);
    setChatOpen(true);
  }

  const isApproved = status === "aprovado";

  async function handleSaveVersion() {
    setSaving(true);
    const res = await fetch(`/api/contracts/${contract.id}/version`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ htmlContent }),
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

  function handleAIUpdate(newHtml: string) {
    setHtmlContent(newHtml);
  }

  return (
    <div className="space-y-4">
      {/* Approved banner */}
      {isApproved && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-green-200 bg-green-50 p-4 text-green-800">
          <div className="flex items-center gap-3">
            <Lock className="h-5 w-5 shrink-0" />
            <div>
              <p className="font-medium text-sm">
                Contrato aprovado - edição bloqueada
              </p>
              <p className="text-xs text-green-600">
                Pronto para envio à assinatura ou export PDF/DOCX.
              </p>
            </div>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link href={`/deals/${contract.dealId}?tab=assinaturas`}>
              Enviar para assinatura
            </Link>
          </Button>
        </div>
      )}

      {/* Banner: falha ao criar Google Doc — usuário caiu no fallback TipTap */}
      {googleDocFailureReason && !isGoogleDocsBacked && !isApproved && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900">
          <CloudOff className="h-5 w-5 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium">Editor Google Docs indisponível</p>
            <p className="text-xs mt-1 text-amber-800">
              Causa: {googleDocFailureReason.slice(0, 240)}
              {googleDocFailureReason.length > 240 ? "…" : ""}
            </p>
            <p className="text-xs mt-1 text-amber-700">
              Você está no editor offline. Tente recriar o contrato pelo deal para usar o Google Docs novamente.
            </p>
          </div>
        </div>
      )}

      {/* Header - sticky to remain visible while scrolling editor */}
      <div className="sticky top-0 z-30 -mx-4 px-4 py-3 sm:-mx-6 sm:px-6 bg-background/95 backdrop-blur-sm border-b flex items-start sm:items-center gap-3 flex-wrap">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/deals/${contract.dealId}`}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            <span className="hidden sm:inline">{contract.dealTitle}</span>
            <span className="sm:hidden">Voltar</span>
          </Link>
        </Button>
        <Separator orientation="vertical" className="h-6 hidden sm:block" />
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-semibold truncate">
            {contract.templateName}
          </h1>
          <div className="flex items-center gap-2 mt-0.5">
            <Badge variant="outline">v{contract.version}</Badge>
            <Badge
              variant={isApproved ? "default" : "secondary"}
              className={isApproved ? "bg-green-600" : ""}
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
              <VersionTimeline versions={versions} currentId={contract.id} />
            </SheetContent>
          </Sheet>

          {isGoogleDocsBacked && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShareOpen(true)}
            >
              <Share2 className="h-4 w-4 sm:mr-1" />
              <span className="hidden sm:inline">Compartilhar</span>
            </Button>
          )}

          <ExportDialog contractId={contract.id} exports={contract.exports} />

          {!isApproved && (
            <>
              {autoSaveStatus !== "idle" && (
                <span
                  className={`text-xs hidden sm:inline ${
                    autoSaveStatus === "error"
                      ? "text-red-600"
                      : autoSaveStatus === "saved"
                      ? "text-green-600"
                      : "text-muted-foreground"
                  }`}
                  title="Auto-save"
                >
                  {autoSaveStatus === "saving" && "Salvando…"}
                  {autoSaveStatus === "saved" && "✓ Salvo"}
                  {autoSaveStatus === "error" && "Erro ao salvar"}
                </span>
              )}
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
                className="bg-green-600 hover:bg-green-700"
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

      {/* SuggestionsToolbar precisa montar fora do iframe quando o contrato é
          Google Doc — o ContractEditor TipTap já monta a própria toolbar. */}
      {isGoogleDocsBacked && !isApproved && (
        <SuggestionsToolbar
          contractId={contract.id}
          editor={null}
          version={commentsVersion}
          onContentChange={() => {}}
          mode="google_docs"
        />
      )}

      {/* Editor — Google Docs iframe quando contrato tem googleDocId, senão TipTap */}
      <div className="rounded-lg border bg-card overflow-hidden">
        {contract.googleDocId ? (
          <GoogleDocsEditor
            googleDocId={contract.googleDocId}
            googleDocUrl={contract.googleDocUrl}
            readOnly={isApproved}
            status={status}
          />
        ) : (
          <ContractEditor
            ref={editorRef}
            content={htmlContent}
            onChange={isApproved ? () => {} : setHtmlContent}
            readOnly={isApproved}
            onAskAI={isApproved ? undefined : handleAskAI}
            onAddComment={isApproved ? undefined : handleAddComment}
            contractId={contract.id}
            suggestionsVersion={commentsVersion}
            onReady={setEditorInstance}
            status={status}
          />
        )}
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
            onCommentClick={handleCommentClick}
            onCommentResolved={handleCommentResolved}
            onAddComment={
              isGoogleDocsBacked && !isApproved
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
        requireSelectedTextInput={isGoogleDocsBacked && !pendingCommentText}
      />

      {/* Share Dialog (só em modo Google Docs) */}
      {isGoogleDocsBacked && (
        <ShareDialog
          open={shareOpen}
          contractId={contract.id}
          onClose={() => setShareOpen(false)}
        />
      )}

      {/* Approval Review Dialog */}
      <ApprovalReviewDialog
        open={reviewOpen}
        data={reviewData}
        onClose={() => setReviewOpen(false)}
        onForceApprove={() => handleApprove(true)}
      />

      {/* Chat Panel */}
      {!isApproved && (
        <Sheet open={chatOpen} onOpenChange={setChatOpen}>
          <SheetContent
            side="right"
            className="w-full sm:w-[400px] md:w-[540px]"
            onInteractOutside={(e) => e.preventDefault()}
            onPointerDownOutside={(e) => e.preventDefault()}
          >
            <SheetHeader>
              <SheetTitle>Assistente Jurídico IA</SheetTitle>
            </SheetHeader>
            <ChatPanel
              contractId={contract.id}
              messages={contract.messages}
              onContentUpdate={handleAIUpdate}
              onChatTurnComplete={() => setCommentsVersion((v) => v + 1)}
              initialInput={chatInitialInput}
            />
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
