"use client";

import { FileText, Loader2, AlertCircle, X, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/forms/NativeSelect";
import { cn } from "@/lib/utils";
import type { Assignment, DocumentKind } from "@/lib/forms/extracted-to-form";
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
}

interface DocumentCardProps {
  doc: DocumentCardData;
  assignmentOptions: Array<{ value: string; label: string }>;
  onAssignmentChange?: (id: string, assignment: Assignment) => void;
  onRemove?: (id: string) => void;
  onRetry?: (id: string) => void;
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

function decodeAssignment(s: string): Assignment {
  const [kind, idx] = s.split(":");
  return { kind: kind as DocumentKind, index: Number(idx) || 0 };
}

export function DocumentCard({
  doc,
  assignmentOptions,
  onAssignmentChange,
  onRemove,
  onRetry,
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

        {doc.status === "failed" && doc.error && (
          <div className="flex items-center justify-between gap-2 rounded bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
            <span className="truncate">{doc.error}</span>
            {onRetry && (
              <button
                type="button"
                onClick={() => onRetry(doc.id)}
                className="shrink-0 font-medium underline"
              >
                Tentar novamente
              </button>
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

        {!readOnly && doc.status === "ready" && onAssignmentChange && (
          <div className="mt-1">
            <NativeSelect
              value={encodeAssignment(doc.assignment)}
              onChange={(val) => onAssignmentChange(doc.id, decodeAssignment(val))}
              options={assignmentOptions}
              className="h-8 text-xs"
            />
          </div>
        )}
      </div>
    </div>
  );
}
