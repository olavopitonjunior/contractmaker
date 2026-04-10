"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ContractEditor } from "./ContractEditor";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { VersionTimeline } from "./VersionTimeline";
import { ExportDialog } from "@/components/export/ExportDialog";
import { ArrowLeft, MessageSquare, History, Download, Save } from "lucide-react";
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

export function ContractEditorPage({ contract, versions }: ContractEditorPageProps) {
  const router = useRouter();
  const [htmlContent, setHtmlContent] = useState(contract.htmlContent);
  const [saving, setSaving] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

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
      toast.success(`Versao ${data.version} salva!`);
      router.refresh();
    } else {
      toast.error("Erro ao salvar versao");
    }
  }

  function handleAIUpdate(newHtml: string) {
    setHtmlContent(newHtml);
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/deals/${contract.dealId}`}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            {contract.dealTitle}
          </Link>
        </Button>
        <Separator orientation="vertical" className="h-6" />
        <div className="flex-1">
          <h1 className="text-lg font-semibold">{contract.templateName}</h1>
          <div className="flex items-center gap-2 mt-0.5">
            <Badge variant="outline">v{contract.version}</Badge>
            <Badge variant="secondary">{contract.status}</Badge>
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setChatOpen(true)}>
            <MessageSquare className="h-4 w-4 mr-1" />
            Chat IA
          </Button>

          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm">
                <History className="h-4 w-4 mr-1" />
                Versoes
              </Button>
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>Historico de Versoes</SheetTitle>
              </SheetHeader>
              <VersionTimeline versions={versions} currentId={contract.id} />
            </SheetContent>
          </Sheet>

          <ExportDialog contractId={contract.id} exports={contract.exports} />

          <Button size="sm" onClick={handleSaveVersion} disabled={saving}>
            <Save className="h-4 w-4 mr-1" />
            {saving ? "Salvando..." : "Salvar Versao"}
          </Button>
        </div>
      </div>

      {/* Editor */}
      <div className="rounded-lg border bg-card">
        <ContractEditor
          content={htmlContent}
          onChange={setHtmlContent}
        />
      </div>

      {/* Chat Panel */}
      <Sheet open={chatOpen} onOpenChange={setChatOpen}>
        <SheetContent side="right" className="w-[400px] sm:w-[540px]">
          <SheetHeader>
            <SheetTitle>Assistente IA</SheetTitle>
          </SheetHeader>
          <ChatPanel
            contractId={contract.id}
            messages={contract.messages}
            onContentUpdate={handleAIUpdate}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}
