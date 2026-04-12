"use client";

import { useState } from "react";
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
import { ContractEditor } from "./ContractEditor";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { VersionTimeline } from "./VersionTimeline";
import { ChangeLogPanel } from "./ChangeLogPanel";
import { ExportDialog } from "@/components/export/ExportDialog";
import {
  ArrowLeft,
  MessageSquare,
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
  const [status, setStatus] = useState(contract.status);

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

  async function handleApprove() {
    setApproving(true);
    const res = await fetch(`/api/contracts/${contract.id}/approve`, {
      method: "POST",
    });
    const data = await res.json();
    setApproving(false);

    if (res.ok) {
      setStatus("aprovado");
      toast.success("Contrato aprovado!");
      router.refresh();
    } else if (res.status === 422) {
      toast.error("Contrato possui erros que impedem a aprovação", {
        description: data.issues?.map((i: any) => i.message).join("; "),
        duration: 10000,
      });
    } else {
      toast.error(data.error || "Erro ao aprovar");
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
                onClick={handleApprove}
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
          content={htmlContent}
          onChange={isApproved ? () => {} : setHtmlContent}
          readOnly={isApproved}
        />
      </div>

      {/* Chat Panel */}
      {!isApproved && (
        <Sheet open={chatOpen} onOpenChange={setChatOpen}>
          <SheetContent side="right" className="w-full sm:w-[400px] md:w-[540px]">
            <SheetHeader>
              <SheetTitle>Assistente Jurídico IA</SheetTitle>
            </SheetHeader>
            <ChatPanel
              contractId={contract.id}
              messages={contract.messages}
              onContentUpdate={handleAIUpdate}
            />
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
