"use client";

import { FileText, Loader2, AlertCircle, X, CheckCircle2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  NativeSelect,
  type SelectOption,
  type SelectGroup,
} from "@/components/forms/NativeSelect";
import { cn } from "@/lib/utils";
import type { Assignment } from "@/lib/forms/extracted-to-form";
import { categoryLabel } from "@/lib/forms/extracted-to-form";

export type DocumentCardStatus = "uploading" | "extracting" | "ready" | "failed";

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
   * Nome legível do slot de quem este doc pode ser cônjuge. Quando setado,
   * o card mostra um badge sugerindo "Possível cônjuge de X" — usado pra
   * evitar duplicata Isabel-cônjuge + Isabel-comprador[1] (bug demo
   * 2026-05-05). Server-side `dedupConjuges` cobre o caso, mas a dica
   * antecipa o problema pro usuário.
   */
  linkedConjugeName?: string | null;
  readOnly?: boolean;
}

function statusLabel(status: DocumentCardStatus): string {
  switch (status) {
    case "uploading":
      return "Enviando…";
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

function encodeAssignment(a: Assignment): string {
  return `${a.kind}:${a.index}`;
}

export function DocumentCard({
  doc,
  assignmentOptions,
  onAssignmentChange,
  onRemove,
  onRetry,
  linkedConjugeName,
  readOnly = false,
}: DocumentCardProps) {
  const isImage = doc.mime.startsWith("image/");
  const fieldEntries = doc.fields
    ? Object.entries(doc.fields).filter(([, v]) => v !== null && v !== "")
    : [];

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
          <img src={doc.fileUrl} alt={doc.filename} className="h-full w-full object-cover" />
        ) : (
          <FileText className="h-8 w-8 text-muted-foreground" />
        )}
      </a>

      {/* Content */}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground" title={doc.filename}>
              {doc.filename}
            </p>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              {doc.category && (
                <Badge variant="secondary" className="text-[10px]">
                  {categoryLabel(doc.category)}
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
            {fieldEntries.slice(0, 6).map(([k, v]) => (
              <div key={k} className="flex gap-1 truncate text-[11px]">
                <span className="text-muted-foreground">{k.replace(/_/g, " ")}:</span>
                <span className="truncate text-foreground" title={formatValue(v)}>
                  {formatValue(v)}
                </span>
              </div>
            ))}
          </div>
        )}

        {linkedConjugeName && doc.status === "ready" && (
          <div className="mt-1 flex items-start gap-1.5 rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span className="break-words">
              Esta pessoa já consta como <strong>cônjuge de {linkedConjugeName}</strong>.
              Selecione "Outros (sem aplicar)" para evitar duplicata — os dados do cônjuge serão consolidados ao finalizar.
            </span>
          </div>
        )}

        {!readOnly && doc.status === "ready" && onAssignmentChange && (
          <div className="mt-1">
            <NativeSelect
              value={encodeAssignment(doc.assignment)}
              onChange={(val) => onAssignmentChange(doc.id, val)}
              options={assignmentOptions}
              className="h-8 text-xs"
            />
          </div>
        )}
      </div>
    </div>
  );
}
