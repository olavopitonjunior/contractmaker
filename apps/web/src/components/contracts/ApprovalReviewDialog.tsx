"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, AlertCircle, MessageSquareText, Sparkles } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ValidationIssue {
  field?: string;
  severity: "error" | "warning" | "info";
  message: string;
  suggestion?: string;
}

export interface ApprovalReviewData {
  canForce: boolean;
  issues: ValidationIssue[];
  errorCount: number;
  warningCount: number;
  pendingSuggestions: number;
  unresolvedComments: number;
  errorComments: number;
}

interface ApprovalReviewDialogProps {
  open: boolean;
  data: ApprovalReviewData | null;
  onClose: () => void;
  onForceApprove: () => void;
}

export function ApprovalReviewDialog({
  open,
  data,
  onClose,
  onForceApprove,
}: ApprovalReviewDialogProps) {
  if (!data) return null;

  const errors = data.issues.filter((i) => i.severity === "error");
  const warnings = data.issues.filter((i) => i.severity === "warning");

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            Revisão necessária antes de aprovar
          </DialogTitle>
          <DialogDescription>
            O contrato tem pontos que merecem sua atenção. Revise antes de prosseguir.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2">
          {data.errorCount > 0 && (
            <Badge variant="destructive" className="gap-1">
              <AlertCircle className="h-3 w-3" />
              {data.errorCount} {data.errorCount === 1 ? "erro" : "erros"}
            </Badge>
          )}
          {data.warningCount > 0 && (
            <Badge variant="secondary" className="gap-1 bg-amber-100 text-amber-800 hover:bg-amber-100">
              <AlertTriangle className="h-3 w-3" />
              {data.warningCount} {data.warningCount === 1 ? "aviso" : "avisos"}
            </Badge>
          )}
          {data.pendingSuggestions > 0 && (
            <Badge variant="secondary" className="gap-1">
              <Sparkles className="h-3 w-3" />
              {data.pendingSuggestions} {data.pendingSuggestions === 1 ? "sugestão pendente" : "sugestões pendentes"}
            </Badge>
          )}
          {data.unresolvedComments > 0 && (
            <Badge variant="secondary" className="gap-1">
              <MessageSquareText className="h-3 w-3" />
              {data.unresolvedComments} {data.unresolvedComments === 1 ? "comentário aberto" : "comentários abertos"}
            </Badge>
          )}
        </div>

        {(errors.length > 0 || warnings.length > 0) && (
          <ScrollArea className="max-h-64 rounded-md border">
            <div className="p-3 space-y-2">
              {errors.map((issue, i) => (
                <div key={`e-${i}`} className="flex gap-2 text-sm">
                  <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                  <div>
                    <p>{issue.message}</p>
                    {issue.suggestion && (
                      <p className="text-xs text-muted-foreground mt-0.5">{issue.suggestion}</p>
                    )}
                  </div>
                </div>
              ))}
              {warnings.map((issue, i) => (
                <div key={`w-${i}`} className="flex gap-2 text-sm">
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <p>{issue.message}</p>
                    {issue.suggestion && (
                      <p className="text-xs text-muted-foreground mt-0.5">{issue.suggestion}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        {!data.canForce && (
          <p className="text-xs text-destructive">
            Há erros que impedem a aprovação. Corrija-os antes de prosseguir.
          </p>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={onClose}>
            Revisar
          </Button>
          {data.canForce && (
            <Button
              onClick={onForceApprove}
              className="bg-green-600 hover:bg-green-700"
            >
              Aprovar mesmo assim
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
