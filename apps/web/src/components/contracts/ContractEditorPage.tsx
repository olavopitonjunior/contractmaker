"use client";

import { useEffect, useRef, useState } from "react";
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
import { ChatPanel } from "@/components/chat/ChatPanel";
import { VersionTimeline } from "./VersionTimeline";
import { ChangeLogPanel } from "./ChangeLogPanel";
import { CommentsPanel } from "./CommentsPanel";
import { AddCommentDialog } from "./AddCommentDialog";
import { ApprovalReviewDialog, type ApprovalReviewData } from "./ApprovalReviewDialog";
import { ExportDialog } from "@/components/export/ExportDialog";
import {
  ArrowLeft,
  MessageSquare,
  MessageSquareText,
  History,
  Save,
  ShieldCheck,
  ScrollText,
  Lock,
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

  // Sincroniza o conteudo e status quando navega entre versoes (mesma tela, prop muda)
  useEffect(() => {
    setHtmlContent(contract.htmlContent);
    setStatus(contract.status);
  }, [contract.id, contract.htmlContent, contract.status]);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [addCommentOpen, setAddCommentOpen] = useState(false);
  const [pendingCommentText, setPendingCommentText] = useState("");
  const [commentsVersion, setCommentsVersion] = useState(0);
  const [reviewData, setReviewData] = useState<ApprovalReviewData | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const editorRef = useRef<ContractEditorHandle>(null);

  function handleAddComment(selectedText: string) {
    setPendingCommentText(selectedText);
    setAddCommentOpen(true);
  }

  async function submitComment(text: string) {
    const res = await fetch(`/api/contracts/${contract.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, selectedText: pendingCommentText }),
    });
    if (res.ok) {
      const created = await res.json();
      editorRef.current?.applyCommentMark(created.anchorId);
      setCommentsVersion((v) => v + 1);
      setCommentsOpen(true);
      toast.success("Comentário adicionado");
    } else {
      toast.error("Erro ao criar comentário");
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
        <div className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 p-4 text-green-800">
          <Lock className="h-5 w-5 shrink-0" />
          <div>
            <p className="font-medium text-sm">
              Contrato aprovado - edição bloqueada
            </p>
            <p className="text-xs text-green-600">
              Este contrato não pode mais ser alterado. Exporte para PDF/DOCX.
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

          {/* Comments */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCommentsOpen(true)}
          >
            <MessageSquareText className="h-4 w-4 sm:mr-1" />
            <span className="hidden sm:inline">Comentários</span>
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

          <ExportDialog contractId={contract.id} exports={contract.exports} />

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

      {/* Editor */}
      <div className="rounded-lg border bg-card overflow-hidden">
        <ContractEditor
          ref={editorRef}
          content={htmlContent}
          onChange={isApproved ? () => {} : setHtmlContent}
          readOnly={isApproved}
          onAskAI={isApproved ? undefined : handleAskAI}
          onAddComment={isApproved ? undefined : handleAddComment}
          contractId={contract.id}
          suggestionsVersion={commentsVersion}
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
            onCommentClick={handleCommentClick}
            onCommentResolved={handleCommentResolved}
          />
        </SheetContent>
      </Sheet>

      {/* Add Comment Dialog */}
      <AddCommentDialog
        open={addCommentOpen}
        selectedText={pendingCommentText}
        onClose={() => setAddCommentOpen(false)}
        onSubmit={submitComment}
      />

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
              initialInput={chatInitialInput}
            />
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
