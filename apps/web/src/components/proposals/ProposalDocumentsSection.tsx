"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import type { SelectGroup } from "@/components/forms/NativeSelect";
import type { Assignment, DocumentKind } from "@/lib/forms/extracted-to-form";
import { buildLocacaoOptions } from "@/components/forms/steps/locacao/locacao-doc-adapter";
import { FIADOR_FLIP_TOAST } from "@/lib/forms/garantia-fiador-flip";
import { mapAttachmentStatusToCard, type AttachmentServerStatus } from "@/lib/forms/attachment-status";
import { readAttachmentExtracted } from "@/lib/proposals/attachment-assignment";
import { FileText, Upload } from "lucide-react";

export interface ProposalDocumentRow {
  id: string;
  filename: string;
  mime: string;
  url: string;
  category: string | null;
  source: string;
  status: string;
  extractError: string | null;
  extractedData: Record<string, unknown> | null;
  createdAt: string;
}

interface ProposalDocumentsSectionProps {
  proposalId: string;
  attachments: ProposalDocumentRow[];
  /** Recorte do dataJson para o seletor "de quem é" (locação). */
  snapshot: {
    locadores: Array<Record<string, unknown>>;
    locatarios: Array<Record<string, unknown>>;
    garantia?: { tipo?: string; fiador?: Record<string, unknown> };
  };
  canEdit: boolean;
  /** URL do documento final (dossiê/aceite) — não exclui pela lista. */
  dossierUrl: string | null;
  /**
   * Ação extra no cabeçalho — hoje o "Anexar Registro do Aceite" (documento do
   * sistema, sem parte; não passa pela dropzone). Cai em "Outros".
   */
  headerAction?: ReactNode;
}

type GroupKind = "locatario" | "fiador" | "locador" | "imovel" | "outro";
const GROUP_LABELS: Record<GroupKind, string> = {
  locatario: "Locatários",
  fiador: "Fiador",
  locador: "Locadores",
  imovel: "Imóvel",
  outro: "Outros",
};
const GROUP_ORDER: GroupKind[] = ["locatario", "fiador", "locador", "imovel", "outro"];

function groupKindOf(kind: DocumentKind): GroupKind {
  if (kind === "locatario" || kind === "representante_locatario" || kind === "conjuge_locatario") return "locatario";
  if (kind === "fiador" || kind === "conjuge_fiador") return "fiador";
  if (kind === "locador" || kind === "representante_locador" || kind === "conjuge_locador") return "locador";
  if (kind === "imovel") return "imovel";
  return "outro";
}

const MAX_BYTES = 20 * 1024 * 1024;
const UPLOAD_CONCURRENCY = 3;

function pLimit(concurrency: number) {
  const queue: Array<() => void> = [];
  let active = 0;
  const next = () => {
    active--;
    const fn = queue.shift();
    if (fn) fn();
  };
  return <T,>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = () => {
        active++;
        fn().then(
          (v) => {
            resolve(v);
            next();
          },
          (e) => {
            reject(e);
            next();
          }
        );
      };
      if (active < concurrency) run();
      else queue.push(run);
    });
}

/**
 * Seção "Documentos por parte" da PROPOSTA de locação — paridade com a aba
 * Documentos do negócio (`LocacaoDocumentsTab`): DocumentCard com mover /
 * extrair com IA / excluir, agrupado por papel, e dropzone com "de quem é"
 * pré-selecionado. Endpoints: `/api/proposals/[id]/attachments/*`.
 *
 * Documentos do sistema (dossiê, PDF assinado, registro do aceite) aparecem
 * em "Outros", sem OCR; o documento final não pode ser excluído (409 na rota).
 */
export function ProposalDocumentsSection({
  proposalId,
  attachments,
  snapshot,
  canEdit,
  dossierUrl,
  headerAction,
}: ProposalDocumentsSectionProps) {
  const router = useRouter();
  const [extractingIds, setExtractingIds] = useState<Set<string>>(new Set());
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadAssignment, setUploadAssignment] = useState<string>("locatario:0");
  const inputRef = useRef<HTMLInputElement>(null);

  const groups: Record<GroupKind, DocumentCardData[]> = {
    locatario: [],
    fiador: [],
    locador: [],
    imovel: [],
    outro: [],
  };
  const sourceById = new Map<string, string>();
  for (const att of attachments) {
    sourceById.set(att.id, att.source);
    const view = readAttachmentExtracted(att.extractedData);
    const ocrable = att.mime === "application/pdf" || att.mime.startsWith("image/");
    const serverStatus = (att.status || "awaiting_user") as AttachmentServerStatus;
    const status: DocumentCardData["status"] = extractingIds.has(att.id)
      ? "extracting"
      : !ocrable
        ? "ready"
        : mapAttachmentStatusToCard(serverStatus, !!view.fields);
    groups[groupKindOf(view.assignment.kind)].push({
      id: att.id,
      filename: att.filename,
      mime: att.mime,
      fileUrl: att.url,
      status,
      category: att.category,
      fields: view.fields,
      confidence: view.confidence,
      error: att.extractError,
      assignment: view.assignment,
      assignmentPersisted: view.assignmentPersisted,
      extractingSince: extractingIds.has(att.id) ? Date.now() : null,
    });
  }

  const assignmentOptions: SelectGroup[] = buildLocacaoOptions(
    { locadores: snapshot.locadores, locatarios: snapshot.locatarios, garantia: snapshot.garantia },
    Object.values(groups).flat()
  );

  async function handleReassign(id: string, value: string) {
    const [kind, idxStr] = value.split(":");
    const index = Number.parseInt(idxStr, 10) || 0;
    const res = await fetch(`/api/proposals/${proposalId}/attachments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignment: { kind, index } }),
    });
    if (res.ok) {
      const d = (await res.json().catch(() => null)) as { garantiaFlipped?: boolean } | null;
      toast.success("Documento movido");
      if (d?.garantiaFlipped) toast.info(`${FIADOR_FLIP_TOAST} — vale ao converter em negócio`);
      router.refresh();
    } else {
      const d = await res.json().catch(() => null);
      toast.error(d?.error || "Erro ao mover documento");
    }
  }

  async function handleExtract(id: string) {
    setExtractingIds((prev) => new Set(prev).add(id));
    try {
      const res = await fetch(`/api/proposals/${proposalId}/attachments/${id}/extract`, { method: "POST" });
      if (res.ok) {
        toast.success("Documento analisado");
        router.refresh();
      } else {
        const d = await res.json().catch(() => null);
        toast.error(d?.error || "Falha na extração");
        router.refresh();
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
    const res = await fetch(`/api/proposals/${proposalId}/attachments/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Documento excluído");
      router.refresh();
    } else {
      const d = await res.json().catch(() => null);
      toast.error(d?.error || "Erro ao excluir documento");
    }
    setPendingDeleteId(null);
  }

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files).filter((f) => {
        if (f.size > MAX_BYTES) {
          toast.error(`${f.name} excede 20 MB`);
          return false;
        }
        return true;
      });
      if (arr.length === 0) return;
      const [kind, idxStr] = uploadAssignment.split(":");
      const assignment = { kind, index: Number.parseInt(idxStr, 10) || 0 };
      setUploading(true);
      const limit = pLimit(UPLOAD_CONCURRENCY);
      let okCount = 0;
      const uploadOne = async (file: File) => {
        try {
          const mime = file.type || "application/octet-stream";
          const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
          const blob = await upload(`proposal-attachments/${proposalId}/${Date.now()}-${safeName}`, file, {
            access: "public",
            contentType: mime,
            handleUploadUrl: `/api/proposals/${proposalId}/attachments/blob-upload`,
          });
          const res = await fetch(`/api/proposals/${proposalId}/attachments/finalize`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: blob.url, filename: file.name, mime, category: "documento", assignment }),
          });
          if (!res.ok) {
            const d = await res.json().catch(() => null);
            toast.error(`${file.name}: ${d?.error || "falha no upload"}`);
            return;
          }
          okCount++;
        } catch (err) {
          toast.error(`${file.name}: ${err instanceof Error ? err.message : "erro"}`);
        }
      };
      await Promise.allSettled(arr.map((f) => limit(() => uploadOne(f))));
      setUploading(false);
      if (okCount > 0) {
        toast.success(`${okCount} documento(s) adicionado(s)`);
        router.refresh();
      }
    },
    [proposalId, uploadAssignment, router]
  );

  const total = attachments.length;
  const flatOptions = assignmentOptions.flatMap((g) => g.options);

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">Documentos por parte ({total})</h2>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">
            Extraia com IA para preencher CPF, nascimento e endereço na conversão.
          </span>
          {headerAction}
        </div>
      </div>

      {total === 0 ? (
        <div className="py-4 text-center text-sm text-muted-foreground">
          <FileText className="mx-auto mb-2 h-8 w-8 opacity-50" />
          Nenhum documento ainda. Anexe RG/CNH, comprovante de renda e de endereço de cada parte.
        </div>
      ) : (
        GROUP_ORDER.filter((k) => groups[k].length > 0).map((k) => (
          <div key={k} className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {GROUP_LABELS[k]} ({groups[k].length})
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {groups[k].map((doc) => {
                const src = sourceById.get(doc.id);
                const isFinal = !!dossierUrl && doc.fileUrl === dossierUrl;
                return (
                  <div key={doc.id} className="relative">
                    {src === "public" && (
                      <Badge variant="outline" className="absolute right-2 top-2 z-10 text-[10px]">
                        enviado pelo cliente
                      </Badge>
                    )}
                    <DocumentCard
                      doc={doc}
                      assignmentOptions={assignmentOptions}
                      onAssignmentChange={canEdit ? handleReassign : undefined}
                      onExtract={canEdit ? handleExtract : undefined}
                      onRemove={canEdit && !isFinal ? (id) => setPendingDeleteId(id) : undefined}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}

      {canEdit && (
        <div className="space-y-2 rounded-md border border-dashed p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label htmlFor="proposal-doc-assignment" className="text-muted-foreground">
              De quem é o documento:
            </label>
            <select
              id="proposal-doc-assignment"
              className="h-8 rounded-md border bg-background px-2 text-sm"
              value={uploadAssignment}
              onChange={(e) => setUploadAssignment(e.target.value)}
              disabled={uploading}
            >
              {flatOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              if (!uploading) handleFiles(e.dataTransfer.files);
            }}
            onClick={() => !uploading && inputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed px-4 py-5 text-sm transition-colors ${
              dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30"
            }`}
          >
            <Upload className="h-5 w-5 text-muted-foreground" />
            <span>{uploading ? "Enviando…" : "Arraste ou clique para anexar (PDF ou imagem, até 20 MB)"}</span>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept="application/pdf,image/*"
              className="hidden"
              onChange={(e) => {
                if (e.target.files) handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
        </div>
      )}

      <AlertDialog open={pendingDeleteId !== null} onOpenChange={(open) => !open && setPendingDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir este documento?</AlertDialogTitle>
            <AlertDialogDescription>
              O arquivo sai da proposta (fica arquivado e pode ser restaurado pelo suporte).
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
    </Card>
  );
}
