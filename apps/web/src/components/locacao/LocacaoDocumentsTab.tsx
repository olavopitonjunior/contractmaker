"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { DocumentCard, type DocumentCardData } from "@/components/forms/DocumentCard";
import { AddDocumentsCard } from "@/components/pipeline/AddDocumentsCard";
import type { SelectGroup } from "@/components/forms/NativeSelect";
import type { Assignment, DocumentKind } from "@/lib/forms/extracted-to-form";
import { buildLocacaoOptions } from "@/components/forms/steps/locacao/locacao-doc-adapter";
import { FIADOR_FLIP_TOAST } from "@/lib/forms/garantia-fiador-flip";
import { FileText } from "lucide-react";

export interface LocacaoAttachment {
  id: string;
  filename: string;
  mime: string;
  url: string;
  category: string | null;
  extractedData: Record<string, unknown> | null;
  createdAt: string;
}

interface ParteOption {
  nome?: string;
  razao_social?: string;
  tipo_pessoa?: string;
}

interface LocacaoDocumentsTabProps {
  dealId: string;
  attachments: LocacaoAttachment[];
  locadores: ParteOption[];
  locatarios: ParteOption[];
  /**
   * Recorte lite do `dataJson` só com o que o seletor precisa: o builder
   * compartilhado com a etapa 0 mostra Fiador/Cônjuge do fiador sempre (o
   * cônjuge só para fiador PF) e usa o nome da parte no rótulo. "Mover para
   * Fiador" aqui também vira a garantia para fiador — o PATCH faz isso no
   * servidor, com a mesma regra da etapa 0.
   */
  garantia?: { tipo?: string; fiador?: Record<string, unknown> };
}

type GroupKind = "locador" | "locatario" | "fiador" | "imovel" | "outro";

const GROUP_LABELS: Record<GroupKind, string> = {
  locador: "Locadores",
  locatario: "Locatários",
  fiador: "Fiador",
  imovel: "Imóvel",
  outro: "Outros",
};

/** Normaliza kinds (incl. representantes e cônjuges) pro grupo visual. */
function groupKindOf(kind: DocumentKind): GroupKind {
  if (
    kind === "locador" ||
    kind === "representante_locador" ||
    kind === "conjuge_locador"
  ) {
    return "locador";
  }
  if (
    kind === "locatario" ||
    kind === "representante_locatario" ||
    kind === "conjuge_locatario"
  ) {
    return "locatario";
  }
  if (kind === "fiador" || kind === "conjuge_fiador") return "fiador";
  if (kind === "imovel") return "imovel";
  return "outro";
}

/**
 * Aba "Documentos" do deal de locação — paridade com a aba Anexos de vendas:
 * DocumentCard com mover/extrair/excluir via /api/deals/[dealId]/attachments/*.
 * Agrupado por papel (locador/locatário/fiador/imóvel/outros).
 */
export function LocacaoDocumentsTab({
  dealId,
  attachments,
  locadores,
  locatarios,
  garantia,
}: LocacaoDocumentsTabProps) {
  const router = useRouter();
  const [extractingIds, setExtractingIds] = useState<Set<string>>(new Set());
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  // DealAttachments → cards (dedupe por url; mesmas convenções de vendas).
  const groups: Record<GroupKind, DocumentCardData[]> = {
    locador: [],
    locatario: [],
    fiador: [],
    imovel: [],
    outro: [],
  };
  const seenUrls = new Set<string>();
  for (const att of attachments) {
    if (seenUrls.has(att.url)) continue;
    seenUrls.add(att.url);
    const extracted = att.extractedData;
    const assignment =
      (extracted?.assignment as Assignment | undefined) ?? {
        kind: "outro" as DocumentKind,
        index: 0,
      };
    const fields = (extracted?.fields as Record<string, unknown> | null) ?? null;
    const ocrable = att.mime === "application/pdf" || att.mime.startsWith("image/");
    const status: DocumentCardData["status"] = extractingIds.has(att.id)
      ? "extracting"
      : fields
        ? "ready"
        : ocrable
          ? "awaiting"
          : "ready";
    groups[groupKindOf(assignment.kind)].push({
      id: att.id,
      filename: att.filename,
      mime: att.mime,
      fileUrl: `/api/deals/${dealId}/attachments/${att.id}/file`,
      status,
      category: att.category,
      fields,
      confidence:
        typeof extracted?.confidence === "number" ? (extracted.confidence as number) : null,
      assignment,
      extractingSince: extractingIds.has(att.id) ? Date.now() : null,
    });
  }

  // Mesmo builder da etapa 0 do formulário de locação (paridade admin ↔
  // cliente): antes daqui o operador não tinha pra onde mover o documento do
  // cônjuge de uma parte.
  const assignmentOptions: SelectGroup[] = buildLocacaoOptions(
    { locadores, locatarios, garantia },
    Object.values(groups).flat()
  );

  async function handleReassign(id: string, value: string) {
    const [kind, idxStr] = value.split(":");
    const index = Number.parseInt(idxStr, 10) || 0;
    const res = await fetch(`/api/deals/${dealId}/attachments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignment: { kind, index } }),
    });
    if (res.ok) {
      toast.success("Documento movido");
      // Mesmo aviso da etapa 0: mover para o fiador definiu a modalidade.
      const d = (await res.json().catch(() => null)) as { garantiaFlipped?: boolean } | null;
      if (d?.garantiaFlipped) toast.info(FIADOR_FLIP_TOAST);
      router.refresh();
    } else {
      const d = await res.json().catch(() => null);
      toast.error(d?.error || "Erro ao mover documento");
    }
  }

  async function handleExtract(id: string) {
    setExtractingIds((prev) => new Set(prev).add(id));
    try {
      const res = await fetch(`/api/deals/${dealId}/attachments/${id}/extract`, {
        method: "POST",
      });
      if (res.ok) {
        toast.success("Documento analisado");
        router.refresh();
      } else {
        const d = await res.json().catch(() => null);
        toast.error(d?.error || "Falha na extração");
      }
    } finally {
      setExtractingIds((prev) => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
    }
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/deals/${dealId}/attachments/${id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      toast.success("Documento excluído");
      router.refresh();
    } else {
      const d = await res.json().catch(() => null);
      toast.error(d?.error || "Erro ao excluir documento");
    }
    setPendingDeleteId(null);
  }

  const total = Object.values(groups).reduce((n, g) => n + g.length, 0);
  const kinds: GroupKind[] = ["locador", "locatario", "fiador", "imovel", "outro"];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Pasta de documentos ({total})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {total === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              <FileText className="mx-auto h-8 w-8 mb-2 opacity-50" />
              Nenhum documento ainda. Os documentos do formulário aparecem aqui
              quando ele é finalizado.
            </div>
          ) : (
            kinds
              .filter((k) => groups[k].length > 0)
              .map((k) => (
                <div key={k} className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {GROUP_LABELS[k]} ({groups[k].length})
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {groups[k].map((doc) => (
                      <DocumentCard
                        key={doc.id}
                        doc={doc}
                        assignmentOptions={assignmentOptions}
                        onAssignmentChange={handleReassign}
                        onExtract={handleExtract}
                        onRemove={(id) => setPendingDeleteId(id)}
                      />
                    ))}
                  </div>
                </div>
              ))
          )}
        </CardContent>
      </Card>

      <AddDocumentsCard dealId={dealId} onUploaded={() => router.refresh()} />

      <AlertDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => !open && setPendingDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir este documento?</AlertDialogTitle>
            <AlertDialogDescription>
              O arquivo sai da pasta do negócio. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                if (pendingDeleteId) handleDelete(pendingDeleteId);
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
