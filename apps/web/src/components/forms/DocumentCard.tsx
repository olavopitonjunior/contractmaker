"use client";

import { useState } from "react";
import { FileText, Loader2, AlertCircle, X, CheckCircle2, RefreshCw, ExternalLink, Download, Sparkles, Wand2, FileSignature, Eye, AlertTriangle } from "lucide-react";
import { ExtractedDataDialog, type WritePreviewEntry } from "@/components/forms/ExtractedDataDialog";
import { collectExtractionIssues } from "@/lib/forms/extracted-to-form";
import { ocrFieldLabel } from "@/lib/forms/ocr-field-labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  NativeSelect,
  type SelectOption,
  type SelectGroup,
} from "@/components/forms/NativeSelect";
import { cn } from "@/lib/utils";
import type { Assignment } from "@/lib/forms/extracted-to-form";
import { documentLabel } from "@/lib/forms/extracted-to-form";

export type DocumentCardStatus =
  | "uploading"
  | "awaiting"
  | "extracting"
  | "ready"
  | "failed";

export interface DocumentCardData {
  id: string;
  filename: string;
  mime: string;
  fileUrl: string;
  status: DocumentCardStatus;
  category: string | null;
  fields: Record<string, unknown> | null;
  confidence: number | null;
  error?: string | null;
  assignment: Assignment;
  /**
   * true = `assignment` veio de `extractedData.assignment` persistido (escolha
   * humana explícita anterior, ex.: a parte atribuiu+aplicou no link dela), não
   * do heurístico `suggest`. Habilita a auto-aplicação aos campos no restore
   * (DocumentosStep) — só reaplicamos automaticamente o que já foi categorizado.
   */
  assignmentPersisted?: boolean;
  applied?: boolean;
  /** Epoch ms quando entrou em extracting; UI mostra aviso se > 60s */
  extractingSince?: number | null;
}

interface DocumentCardProps {
  doc: DocumentCardData;
  assignmentOptions: SelectOption[] | SelectGroup[];
  onAssignmentChange?: (id: string, assignmentValue: string) => void;
  onRemove?: (id: string) => void;
  onRetry?: (id: string) => void;
  /**
   * Disparado quando o usuário clica em "Extrair com IA" pra um doc com
   * status "awaiting". Caller faz POST /attachments/[id]/extract.
   */
  onExtract?: (id: string) => void;
  /**
   * Aplica os campos extraídos no negócio (autofill). Quando presente e o doc
   * está "ready" com fields + assignment definido, mostra "Aplicar aos campos".
   */
  onApply?: (id: string) => void;
  /**
   * Envia o documento (PDF) pra assinatura. Quando presente e o doc é PDF,
   * mostra "Enviar para assinatura". Caller abre o SendAttachmentEnvelopeDialog.
   */
  onSendToSignature?: (id: string) => void;
  readOnly?: boolean;
  /** Em voo (ex.: copiando o doc do formulário pro negócio) — desabilita as
   *  ações de mover/assinar e mostra spinner. */
  busy?: boolean;
  /**
   * O que o "Aplicar aos campos" escreveria, para o dialog de revisão mostrar
   * ANTES de aplicar. Calculado por `computeDocWrites`, que precisa do adapter
   * e do form — ambos vivem no DocumentosStep, não aqui. Função (e não valor)
   * porque só interessa quando o dialog abre: rodar o mapper em toda renderização
   * de todo card seria trabalho jogado fora.
   */
  getWritePreview?: (id: string) => WritePreviewEntry[] | null;
  /** Grava correções manuais nos campos extraídos (abre a edição no dialog). */
  onFieldsEdit?: (id: string, fields: Record<string, string>) => Promise<void> | void;
}

function statusLabel(status: DocumentCardStatus): string {
  switch (status) {
    case "uploading":
      return "Enviando…";
    case "awaiting":
      return "Aguardando extração";
    case "extracting":
      return "Analisando…";
    case "ready":
      return "Pronto";
    case "failed":
      return "Falhou";
  }
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Campos mostrados no card antes do "+N campos". O resto vem no dialog. */
const CAMPOS_VISIVEIS = 6;

function encodeAssignment(a: Assignment): string {
  return `${a.kind}:${a.index}`;
}

export function DocumentCard({
  doc,
  assignmentOptions,
  onAssignmentChange,
  onRemove,
  onRetry,
  onExtract,
  onApply,
  onSendToSignature,
  readOnly = false,
  busy = false,
  getWritePreview,
  onFieldsEdit,
}: DocumentCardProps) {
  const isImage = doc.mime.startsWith("image/");
  const fieldEntries = doc.fields
    ? Object.entries(doc.fields).filter(([, v]) => v !== null && v !== "")
    : [];
  const [dialogOpen, setDialogOpen] = useState(false);
  const [camposExpandidos, setCamposExpandidos] = useState(false);
  const [writePreview, setWritePreview] = useState<WritePreviewEntry[] | null>(null);
  /** Calcula o preview UMA vez, no clique, e abre. */
  const abrirDialog = () => {
    setWritePreview(getWritePreview?.(doc.id) ?? null);
    setDialogOpen(true);
  };
  // CPF com dígito verificador errado é o único problema que NÃO é descartado:
  // entra no formulário parecendo bom e só falha na certidão ou na assinatura.
  // Por isso ganha um aviso no próprio card, sem precisar abrir o dialog.
  const criticos = collectExtractionIssues(doc.fields).filter(
    (i) => i.reason === "cpf_invalido"
  );

  return (
    <div
      className={cn(
        "relative flex gap-3 rounded-lg border border-border bg-card p-3 shadow-xs",
        doc.status === "failed" && "border-destructive/40 bg-destructive/5",
        doc.applied && "border-emerald-500/40 bg-emerald-500/5"
      )}
    >
      {/* Thumbnail */}
      <a
        href={doc.fileUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted"
      >
        {isImage && doc.status !== "uploading" ? (
          // Miniatura de upload do usuário, URL de blob arbitrária. Trocar por
          // `next/image` exige dimensões e allowlist de domínio — mudança real,
          // fora do escopo deste PR de higiene (#374).
          // eslint-disable-next-line @next/next/no-img-element
          <img src={doc.fileUrl} alt={doc.filename} className="h-full w-full object-cover" />
        ) : (
          <FileText className="h-8 w-8 text-muted-foreground" />
        )}
      </a>

      {/* Content */}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <a
              href={doc.fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block truncate text-sm font-medium text-foreground hover:underline"
              title={doc.filename}
            >
              {doc.filename}
            </a>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              {doc.category && (
                <Badge variant="secondary" className="text-[10px]">
                  {documentLabel(doc.category, doc.fields)}
                </Badge>
              )}
              {doc.confidence !== null && doc.confidence !== undefined && (
                <span className="text-[10px] text-muted-foreground">
                  {Math.round(doc.confidence * 100)}% confiança
                </span>
              )}
              {doc.status !== "ready" && (
                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                  {doc.status === "uploading" || doc.status === "extracting" ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : doc.status === "failed" ? (
                    <AlertCircle className="h-3 w-3 text-destructive" />
                  ) : doc.status === "awaiting" ? (
                    <Sparkles className="h-3 w-3 text-amber-600" />
                  ) : null}
                  {statusLabel(doc.status)}
                </span>
              )}
              {doc.applied && (
                <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-3 w-3" />
                  Aplicado
                </span>
              )}
            </div>
          </div>

          {!readOnly && onRemove && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
              onClick={() => onRemove(doc.id)}
              aria-label="Remover"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        {/* Status "awaiting": doc anexado, mas extração IA não rolou ainda.
            Usuário decide quando gastar tokens — alguns docs são apenas
            evidência visual e não precisam de OCR. */}
        {doc.status === "awaiting" && !readOnly && onExtract && (
          <div className="flex flex-wrap items-center gap-1.5 rounded bg-amber-50 border border-amber-200 px-2 py-1.5 text-[11px] dark:bg-amber-950/40 dark:border-amber-900">
            <span className="text-amber-900 dark:text-amber-200 flex-1 min-w-0">
              Anexado. Quer que a IA leia e preencha os campos automaticamente?
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[11px] border-amber-400 text-amber-900 hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-900/50"
              onClick={() => onExtract(doc.id)}
            >
              <Sparkles className="h-3 w-3 mr-1" />
              Extrair com IA
            </Button>
          </div>
        )}

        {doc.status === "failed" && (doc.error || true) && (
          <div className="flex flex-col gap-1.5 rounded bg-destructive/10 px-2 py-2 text-[11px] text-destructive">
            <div className="flex items-start gap-1.5">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span className="break-words">
                {doc.error || "Falha na extração"}
              </span>
            </div>
            <div className="flex gap-1.5">
              {onRetry && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[11px] border-destructive/40 text-destructive hover:bg-destructive/10"
                  onClick={() => onRetry(doc.id)}
                >
                  <RefreshCw className="h-3 w-3 mr-1" />
                  Tentar novamente
                </Button>
              )}
              {onRemove && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[11px] text-muted-foreground"
                  onClick={() => onRemove(doc.id)}
                >
                  Remover
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Aviso "está demorando" quando extracting > 60s — rate limit? travado? */}
        {doc.status === "extracting" &&
          doc.extractingSince &&
          Date.now() - doc.extractingSince > 60_000 && (
            <div className="flex flex-col gap-1.5 rounded bg-amber-50 border border-amber-200 px-2 py-2 text-[11px] text-amber-900">
              <div className="flex items-start gap-1.5">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span className="break-words">
                  Extração demorando mais que o esperado. Pode ser limite de uso
                  do Gemini — aguarde ou reenvie.
                </span>
              </div>
              {onRetry && (
                <div className="flex gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[11px] border-amber-400 text-amber-900 hover:bg-amber-100"
                    onClick={() => onRetry(doc.id)}
                  >
                    <RefreshCw className="h-3 w-3 mr-1" />
                    Reenviar para fila
                  </Button>
                </div>
              )}
            </div>
          )}

        {fieldEntries.length > 0 && (
          <div className="grid grid-cols-1 gap-x-3 gap-y-0.5 sm:grid-cols-2">
            {(camposExpandidos
              ? fieldEntries
              : fieldEntries.slice(0, CAMPOS_VISIVEIS)
            ).map(([k, v]) => (
              <div key={k} className="flex gap-1 truncate text-[11px]">
                <span className="text-muted-foreground">{ocrFieldLabel(k)}:</span>
                <span className="truncate text-foreground" title={formatValue(v)}>
                  {formatValue(v)}
                </span>
              </div>
            ))}
            {/* O corte fixo em 6 escondia o resto SEM dizer que existia — numa
                matrícula com ~20 campos o revisor concluía que o OCR não tinha
                lido justamente o que ele procurava. */}
            {fieldEntries.length > CAMPOS_VISIVEIS && (
              <button
                type="button"
                onClick={() => setCamposExpandidos((v) => !v)}
                className="justify-self-start text-left text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                {camposExpandidos
                  ? "Ver menos"
                  : `+ ${fieldEntries.length - CAMPOS_VISIVEIS} campo(s)`}
              </button>
            )}
          </div>
        )}

        {criticos.length > 0 && doc.status === "ready" && (
          <button
            type="button"
            onClick={abrirDialog}
            className="mt-1 flex items-center gap-1 text-left text-[11px] text-destructive hover:underline"
          >
            <AlertTriangle className="h-3 w-3 shrink-0" />
            {criticos.length === 1
              ? "1 campo precisa de conferência"
              : `${criticos.length} campos precisam de conferência`}
          </button>
        )}

        {/* O destino aparece desde o upload, não só quando a extração termina.
            Antes o dropdown só existia em `ready`: quem subia o documento não
            via onde ele iria parar, e a atribuição "só aparecia depois de
            clicar fora e aplicar" (relato da corretora, 2026-08-25). */}
        {!readOnly && doc.status !== "uploading" && onAssignmentChange && (
          <div className="mt-1 flex items-center gap-1.5">
            <span className="shrink-0 text-[11px] text-muted-foreground">
              Atribuir a:
            </span>
            <NativeSelect
              value={encodeAssignment(doc.assignment)}
              onChange={(val) => onAssignmentChange(doc.id, val)}
              options={assignmentOptions}
              className="h-8 text-xs"
              disabled={busy}
            />
            {busy && (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
            )}
          </div>
        )}

        {doc.status === "ready" && (
          <div className="mt-1 flex flex-wrap gap-1">
            {fieldEntries.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={abrirDialog}
                className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <Eye className="h-3 w-3 mr-1" />
                Ver dados
              </Button>
            )}
            {/* Reanálise de um documento JÁ pronto. A rota `/retry` sempre
                aceitou qualquer status — só a UI não oferecia o botão, e um
                documento cujo OCR saiu errado só tinha saída removendo e
                subindo de novo. */}
            {!readOnly && onRetry && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                onClick={() => {
                  if (
                    fieldEntries.length > 0 &&
                    !window.confirm(
                      "Reanalisar substitui os dados já extraídos deste documento. Continuar?"
                    )
                  ) {
                    return;
                  }
                  onRetry(doc.id);
                }}
              >
                <Sparkles className="h-3 w-3 mr-1" />
                Reanalisar
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              asChild
              className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3 w-3 mr-1" />
                Abrir
              </a>
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              asChild
              className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <a
                href={`${doc.fileUrl}${doc.fileUrl.includes("?") ? "&" : "?"}download=1`}
              >
                <Download className="h-3 w-3 mr-1" />
                Baixar
              </a>
            </Button>
            {!readOnly &&
              onApply &&
              doc.fields &&
              doc.assignment.kind !== "outro" &&
              !doc.applied && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-[11px]"
                  onClick={() => onApply(doc.id)}
                >
                  <Wand2 className="h-3 w-3 mr-1" />
                  Aplicar aos campos do negócio
                </Button>
              )}
            {!readOnly && onSendToSignature && doc.mime === "application/pdf" && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2 text-[11px]"
                onClick={() => onSendToSignature(doc.id)}
                disabled={busy}
              >
                {busy ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : (
                  <FileSignature className="h-3 w-3 mr-1" />
                )}
                Enviar para assinatura
              </Button>
            )}
            {/* Não-PDF: assinatura digital (ClickSign) só aceita PDF. Em vez de
                sumir silenciosamente, mostra o motivo. */}
            {!readOnly && onSendToSignature && doc.mime !== "application/pdf" && (
              <span
                className="inline-flex items-center h-7 px-2 text-[11px] text-muted-foreground"
                title="A assinatura digital aceita apenas PDF. Converta este arquivo para PDF para enviá-lo."
              >
                <FileSignature className="h-3 w-3 mr-1" />
                Assinatura: só PDF
              </span>
            )}
          </div>
        )}
      </div>

      {/* Montado só quando aberto, e o preview é calculado UMA vez, no clique
          que abre — não a cada render. `getWritePreview` roda o mapper inteiro
          e é recriado sempre que a lista de docs muda; chamá-lo inline no JSX
          o re-executaria a cada re-render do card com o dialog aberto. */}
      {dialogOpen && (
        <ExtractedDataDialog
          open={dialogOpen}
          onOpenChange={(v) => {
            setDialogOpen(v);
            if (!v) setWritePreview(null);
          }}
          filename={doc.filename}
          category={doc.category}
          fields={doc.fields}
          confidence={doc.confidence}
          writePreview={writePreview}
          onSaveFields={
            !readOnly && onFieldsEdit
              ? (campos) => onFieldsEdit(doc.id, campos)
              : undefined
          }
        />
      )}
    </div>
  );
}
